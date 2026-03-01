/**
 * Offline-First Sync Layer
 * Synchronizes jobs between IndexedDB and Supabase
 * Handles conflicts, retries, and background sync
 */

class SyncEngine {
  constructor(supabaseClient, jobTrackerDB, jobTrackerState) {
    this.supabase = supabaseClient;
    this.db = jobTrackerDB;
    this.state = jobTrackerState;
    this.isSyncing = false;
    this.lastSyncTime = localStorage.getItem('nx_last_sync_time') ? new Date(localStorage.getItem('nx_last_sync_time')) : null;
    this.syncInterval = 30000; // 30 seconds
    this.lastRemoteCheckTime = null;
    this.lastRemoteCount = 0;

    console.log('[SyncEngine] Initialized');
  }

  /**
   * Initialize sync - pull remote changes if authenticated
   */
  async init() {
    console.log('[SyncEngine] Starting initialization');
    
    // Check if user is authenticated
    const status = this.supabase.getStatus();
    if (!status.isAuthenticated) {
      console.log('[SyncEngine] Not authenticated, skipping initial sync');
      return false;
    }

    // Pull any remote changes
    await this.pullRemoteJobs();
    
    // Initialize remote count tracker
    const remoteJobs = await this.supabase.select('jobs', {
      eq: { user_id: this.supabase.userId }
    });
    this.lastRemoteCount = Array.isArray(remoteJobs) ? remoteJobs.length : 0;
    
    // Start periodic sync (faster interval for real-time-ish feel)
    this.startPeriodicSync();
    
    // Set up event listeners for when jobs are added locally
    window.addEventListener('nx-job-added', () => this.fullSync());
    window.addEventListener('nx-job-updated', () => this.fullSync());
    window.addEventListener('nx-job-deleted', () => this.fullSync());
    
    return true;
  }

  /**
   * Pull jobs from Supabase
   */
  async pullRemoteJobs() {
    if (!this.supabase.isOnline) {
      console.log('[SyncEngine] Offline, skipping pull');
      return false;
    }

    console.log('[SyncEngine] Pulling remote jobs for user:', this.supabase.userId);
    try {
      // Get all jobs for current user
      const remoteJobs = await this.supabase.select('jobs', {
        eq: { user_id: this.supabase.userId }
      });

      console.log('[SyncEngine] pullRemoteJobs result:', remoteJobs);
      
      if (!Array.isArray(remoteJobs)) {
        console.warn('[SyncEngine] No remote jobs found or fetch failed, result type:', typeof remoteJobs);
        return false;
      }

      console.log(`[SyncEngine] Pulled ${remoteJobs.length} remote jobs`);
      
      if (remoteJobs.length > 0) {
        console.log('[SyncEngine] Sample remote job:', remoteJobs[0]);
      }
      
      let changesDetected = false;
      const mergedJobIds = new Set();

      // Merge with local jobs using conflict resolution
      for (const remoteJob of remoteJobs) {
        mergedJobIds.add(remoteJob.id);
        const changed = await this.mergeJob(remoteJob, 'remote');
        if (changed) changesDetected = true;
      }
      
      // Sync merged jobs back to app.js global state
      console.log('[SyncEngine] Final state - app.js:', window.state ? window.state.jobs.length : '?', 'jobs, modular:', this.state ? this.state.jobs.length : '?');
      
      // Only re-render if there were actual changes
      if (changesDetected) {
        if (window.state) {
          console.log('[SyncEngine] Re-rendering with app.js state');
          // Make sure app.js re-renders with the merged data
          if (window.render && typeof window.render === 'function') {
            window.render(true); // soft update
          }
        }
      }
      
      return changesDetected;

    } catch (error) {
      console.error('[SyncEngine] Pull failed:', error);
      return false;
    }
  }
  
  /**
   * Check for remote updates since last sync
   */
  async hasRemoteUpdates() {
    if (!this.supabase.isOnline) {
      return false;
    }

    try {
      // Query jobs updated since last sync or just check count
      const remoteJobs = await this.supabase.select('jobs', {
        eq: { user_id: this.supabase.userId }
      });

      if (!Array.isArray(remoteJobs)) return false;

      // Check if count has changed
      if (remoteJobs.length !== this.lastRemoteCount) {
        console.log('[SyncEngine] Remote job count changed:', this.lastRemoteCount, '->', remoteJobs.length);
        this.lastRemoteCount = remoteJobs.length;
        return true;
      }

      // Check if any remote job is newer than local equivalent
      for (const remoteJob of remoteJobs) {
        const remoteTime = new Date(remoteJob.updated_at || 0);
        const localJob = this.state.getJob(remoteJob.id);
        
        if (!localJob || remoteTime > new Date(localJob.updated_at || 0)) {
          console.log('[SyncEngine] Detected remote update for job:', remoteJob.id);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('[SyncEngine] Remote check failed:', error);
      return false;
    }
  }

  /**
   * Push local jobs to Supabase
   */
  async pushLocalJobs() {
    if (!this.supabase.isOnline) {
      console.log('[SyncEngine] Offline, skipping push');
      return;
    }

    console.log('[SyncEngine] Pushing local jobs');
    try {
      // Use app.js state if available, otherwise use modular state
      const localJobs = (window.state && window.state.jobs) ? window.state.jobs : this.state.jobs;
      console.log('[SyncEngine] Pushing', localJobs.length, 'jobs from', window.state ? 'app.js' : 'modular', 'state');
      
      for (const localJob of localJobs) {
        // Check if job exists remote
        const remoteJob = await this.supabase.select('jobs', {
          eq: { id: localJob.id }
        });

        if (!remoteJob || remoteJob.length === 0) {
          // New job - insert
          const jobData = this.prepareJobForCloud(localJob);
          console.log('[SyncEngine] Inserting new job:', localJob.id, jobData);
          const result = await this.supabase.insert('jobs', jobData);
          
          if (result.success) {
            console.log(`[SyncEngine] ✓ Pushed new job: ${localJob.id}`);
            // Update local timestamp
            localJob.synced_at = new Date().toISOString();
            await this.db.saveJob(localJob);
          } else {
            console.warn(`[SyncEngine] ✗ Failed to push job ${localJob.id}:`, result);
          }
        } else {
          // Existing job - check for conflicts
          const conflict = this.detectConflict(localJob, remoteJob[0]);
          if (conflict) {
            console.log(`[SyncEngine] Conflict detected for ${localJob.id}, resolving...`);
            await this.resolveConflict(localJob, remoteJob[0]);
          } else if (this.shouldUpdate(localJob, remoteJob[0])) {
            // Update if local is newer
            const jobData = this.prepareJobForCloud(localJob);
            const result = await this.supabase.update('jobs', jobData, { id: localJob.id });
            
            if (result.success) {
              console.log(`[SyncEngine] ✓ Pushed update to job: ${localJob.id}`);
              localJob.synced_at = new Date().toISOString();
              await this.db.saveJob(localJob);
            }
          }
        }
      }

      // Update last sync time
      this.lastSyncTime = new Date();
      localStorage.setItem('nx_last_sync_time', this.lastSyncTime.toISOString());
      console.log('[SyncEngine] ✓ Push complete');

    } catch (error) {
      console.error('[SyncEngine] ✗ Push failed:', error);
    }
  }

  /**
   * Full bi-directional sync
   */
  async fullSync() {
    console.log('[SyncEngine] fullSync called - isSyncing:', this.isSyncing, 'isOnline:', this.supabase.isOnline);
    
    if (this.isSyncing || !this.supabase.isOnline) {
      console.log('[SyncEngine] Sync skipped - already in progress or offline');
      return;
    }

    this.isSyncing = true;
    console.log('[SyncEngine] Starting full sync');
    
    try {
      console.log('[SyncEngine] Step 1: Pull remote jobs');
      const pullResult = await this.pullRemoteJobs();
      console.log('[SyncEngine] Pull result:', pullResult);
      
      console.log('[SyncEngine] Step 2: Push local jobs');
      await this.pushLocalJobs();
      
      console.log('[SyncEngine] ✓ Full sync complete');
    } catch (error) {
      console.error('[SyncEngine] ✗ Full sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync specific job
   */
  async syncJob(jobId) {
    if (!this.supabase.isOnline) {
      console.log(`[SyncEngine] Offline, queuing sync for job ${jobId}`);
      return;
    }

    console.log(`[SyncEngine] Syncing job: ${jobId}`);
    try {
      const localJob = this.state.getJob(jobId);
      if (!localJob) {
        console.warn(`[SyncEngine] Job not found locally: ${jobId}`);
        return;
      }

      const remoteJobs = await this.supabase.select('jobs', {
        eq: { id: jobId }
      });

      if (!Array.isArray(remoteJobs) || remoteJobs.length === 0) {
        // New job
        const jobData = this.prepareJobForCloud(localJob);
        const result = await this.supabase.insert('jobs', jobData);
        if (result.success) {
          localJob.synced_at = new Date().toISOString();
          await this.db.saveJob(localJob);
        }
      } else {
        // Existing job
        const remoteJob = remoteJobs[0];
        const conflict = this.detectConflict(localJob, remoteJob);
        
        if (conflict) {
          await this.resolveConflict(localJob, remoteJob);
        } else if (this.shouldUpdate(localJob, remoteJob)) {
          const jobData = this.prepareJobForCloud(localJob);
          const result = await this.supabase.update('jobs', jobData, { id: jobId });
          if (result.success) {
            localJob.synced_at = new Date().toISOString();
            await this.db.saveJob(localJob);
          }
        }
      }
    } catch (error) {
      console.error(`[SyncEngine] Sync job ${jobId} failed:`, error);
    }
  }

  /**
   * Detect if local and remote versions have conflicting changes
   */
  detectConflict(localJob, remoteJob) {
    // Conflict exists if both have been modified since last sync
    if (!localJob.synced_at) return false;
    
    const lastSync = new Date(localJob.synced_at);
    const localModified = new Date(localJob.updated_at || 0);
    const remoteModified = new Date(remoteJob.updated_at || 0);

    // Both modified after last sync = conflict
    return localModified > lastSync && remoteModified > lastSync;
  }

  /**
   * Resolve conflict using "last write wins"
   */
  async resolveConflict(localJob, remoteJob) {
    console.log(`[SyncEngine] Resolving conflict for job ${localJob.id}`);
    
    const localTime = new Date(localJob.updated_at || 0);
    const remoteTime = new Date(remoteJob.updated_at || 0);

    if (localTime > remoteTime) {
      // Local is newer - push it
      console.log('[SyncEngine] Local version is newer, pushing to remote');
      const jobData = this.prepareJobForCloud(localJob);
      await this.supabase.update('jobs', jobData, { id: localJob.id });
    } else {
      // Remote is newer - pull it
      console.log('[SyncEngine] Remote version is newer, pulling to local');
      localJob.status = remoteJob.status;
      localJob.fee = remoteJob.fee;
      localJob.elf = remoteJob.elf;
      localJob.candids = remoteJob.candids;
      localJob.chargeback = remoteJob.chargeback;
      localJob.updated_at = remoteJob.updated_at;
      localJob.synced_at = new Date().toISOString();
      await this.db.saveJob(localJob);
    }
  }

  /**
   * Check if local version should be pushed
   */
  shouldUpdate(localJob, remoteJob) {
    const localTime = new Date(localJob.updated_at || 0);
    const remoteTime = new Date(remoteJob.updated_at || 0);
    return localTime > remoteTime;
  }

  /**
   * Prepare job for cloud storage
   */
  prepareJobForCloud(job) {
    // Handle both naming conventions (app.js uses `type`, modular uses `jobType`)
    const jobType = job.jobType || job.type;
    const upgraded = job.upgraded !== undefined ? job.upgraded : job.isUpgraded;
    const jobId = job.jobId || job.jobID;
    
    return {
      id: job.id,
      user_id: this.supabase.userId,
      job_type: jobType,
      date: job.date,
      status: job.status,
      fee: job.fee,
      base_fee: job.baseFee,
      manual_fee: job.manualFee,
      job_id_external: jobId,
      notes: job.notes,
      is_upgraded: upgraded,
      saturday_premium: job.saturdayPremium,
      elf: job.elf,
      elf_added_by: job.elfAddedBy,
      elf_added_date: job.elfAddedDate,
      candids: job.candids,
      candids_reason: job.candidsReason,
      candids_added_by: job.candidsAddedBy,
      candids_added_date: job.candidsAddedDate,
      chargeback: job.chargeback,
      chargeback_reason: job.chargebackReason,
      chargeback_amount: job.chargebackAmount,
      chargeback_week: job.chargebackWeek,
      chargeback_added_by: job.chargebackAddedBy,
      chargeback_added_date: job.chargebackAddedDate,
      completed_at: job.completedAt,
      updated_at: job.updated_at || new Date().toISOString()
    };
  }

  /**
   * Merge remote job into local state
   */
  async mergeJob(remoteJob, source = 'remote') {
    // Try to find in app.js state first if available
    let localJob = null;
    let stateLocation = 'modular';
    
    if (window.state && window.state.jobs) {
      localJob = window.state.jobs.find(j => j.id === remoteJob.id);
      stateLocation = 'app.js';
    } 
    
    if (!localJob && this.state && this.state.jobs) {
      localJob = this.state.getJob(remoteJob.id);
      stateLocation = 'modular';
    }

    if (!localJob) {
      // New remote job - create locally (prefer app.js location if available)
      const newJob = this.reconstructJobFromCloud(remoteJob);
      
      if (window.state && window.state.jobs) {
        window.state.jobs.push(newJob);
        localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
        console.log(`[SyncEngine] ✓ Merged new job from ${source}: ${remoteJob.id} (to app.js)`);
      } else if (this.state && this.state.jobs) {
        this.state.jobs.push(newJob);
        await this.db.saveJob(newJob);
        console.log(`[SyncEngine] ✓ Merged new job from ${source}: ${remoteJob.id} (to modular)`);
      }
      
      return true; // change detected
    } else {
      // Update if remote is newer
      const localTime = new Date(localJob.updated_at || 0);
      const remoteTime = new Date(remoteJob.updated_at || 0);

      if (remoteTime > localTime) {
        console.log(`[SyncEngine] Updating job ${remoteJob.id} - remote is newer (remote: ${remoteTime.toISOString()}, local: ${localTime.toISOString()})`);
        const updatedJob = this.reconstructJobFromCloud(remoteJob);
        Object.assign(localJob, updatedJob);
        
        if (stateLocation === 'app.js' && window.state) {
          localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
        } else if (stateLocation === 'modular') {
          await this.db.saveJob(localJob);
        }
        
        console.log(`[SyncEngine] ✓ Merged update from ${source}: ${remoteJob.id} (to ${stateLocation})`);
        return true; // change detected
      } else {
        console.log(`[SyncEngine] Skipping job ${remoteJob.id} - local is up to date`);
      }
    }
    
    return false; // no change
  }

  /**
   * Reconstruct job from cloud format to local format (app.js format)
   */
  reconstructJobFromCloud(remoteJob) {
    return {
      id: remoteJob.id,
      type: remoteJob.job_type,
      date: remoteJob.date,
      status: remoteJob.status,
      fee: remoteJob.fee,
      baseFee: remoteJob.base_fee,
      manualFee: remoteJob.manual_fee,
      jobID: remoteJob.job_id_external,
      notes: remoteJob.notes,
      isUpgraded: remoteJob.is_upgraded,
      saturdayPremium: remoteJob.saturday_premium,
      elf: remoteJob.elf,
      elfAddedBy: remoteJob.elf_added_by,
      elfAddedDate: remoteJob.elf_added_date,
      candids: remoteJob.candids,
      candidsReason: remoteJob.candids_reason,
      candidsAddedBy: remoteJob.candids_added_by,
      candidsAddedDate: remoteJob.candids_added_date,
      chargeback: remoteJob.chargeback,
      chargebackReason: remoteJob.chargeback_reason,
      chargebackAmount: remoteJob.chargeback_amount,
      chargebackWeek: remoteJob.chargeback_week,
      chargebackAddedBy: remoteJob.chargeback_added_by,
      chargebackAddedDate: remoteJob.chargeback_added_date,
      completedAt: remoteJob.completed_at,
      updated_at: remoteJob.updated_at,
      synced_at: new Date().toISOString()
    };
  }

  /**
   * Start periodic sync timer with smart change detection
   */
  startPeriodicSync() {
    console.log(`[SyncEngine] Starting periodic sync every ${this.syncInterval}ms`);
    setInterval(async () => {
      if (this.supabase.isOnline && !this.isSyncing) {
        // Quick check for remote updates first
        if (await this.hasRemoteUpdates()) {
          console.log('[SyncEngine] Remote updates detected, pulling...');
          await this.pullRemoteJobs();
        }
      }
    }, this.syncInterval);
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      isOnline: this.supabase.isOnline,
      queuedOperations: this.supabase.syncQueue.length,
      localJobCount: this.state.jobs.length
    };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncEngine;
}

// Ensure global availability in browser
window.SyncEngine = SyncEngine;
