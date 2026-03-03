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
    this.periodicSyncId = null;
    this.eventsBound = false;

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
    
    // Start periodic sync
    this.startPeriodicSync();
    
    // Set up event listeners once
    if (!this.eventsBound) {
      window.addEventListener('nx-job-added', () => this.fullSync());
      window.addEventListener('nx-job-updated', () => this.fullSync());
      window.addEventListener('nx-job-deleted', () => this.fullSync());
      this.eventsBound = true;
    }
    
    return true;
  }

  /**
   * Pull jobs from Supabase
   */
  async pullRemoteJobs() {
    const status = this.supabase.getStatus();
    if (!this.supabase.isOnline || !status.isAuthenticated || !this.supabase.userId) {
      console.log('[SyncEngine] Offline, skipping pull');
      return false;
    }

    console.log('[SyncEngine] Pulling remote jobs for user:', this.supabase.userId);
    try {
      // Refresh deletedJobIds from localStorage before pull - ensure we have the latest
      // Always use user-scoped key to prevent cross-user pollution
      const deletedKey = `nx_deleted_job_ids_user_${this.supabase.userId}`;
      const freshDeletedJobIds = JSON.parse(localStorage.getItem(deletedKey) || '[]');
      if (window.state) {
        window.state.deletedJobIds = freshDeletedJobIds;
      }
      console.log('[SyncEngine] Refreshed deletedJobIds from storage, count:', freshDeletedJobIds.length, 'key:', deletedKey);

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
      const beforeCount = window.state && window.state.jobs ? window.state.jobs.length : 0;

      // Use the freshly-loaded deleted job IDs from storage
      const deletedJobIds = freshDeletedJobIds;
      
      // Merge with local jobs using conflict resolution
      for (const remoteJob of remoteJobs) {
        // Skip deleted jobs - don't re-pull them from cloud
        if (deletedJobIds.includes(remoteJob.id)) {
          console.log('[SyncEngine] Skipping deleted job:', remoteJob.id);
          continue;
        }
        const changed = await this.mergeJob(remoteJob, 'remote');
        if (changed) changesDetected = true;
      }
      
      const afterCount = window.state && window.state.jobs ? window.state.jobs.length : 0;
      console.log(`[SyncEngine] Job count before: ${beforeCount}, after: ${afterCount}`);
      
      // Detect changes by count or explicit flag
      if (afterCount > beforeCount) {
        changesDetected = true;
        console.log('[SyncEngine] Detected changes by job count increase');
      }
      
      // Always re-render if we pulled any jobs (even if count didn't change, they might need to display)
      if (remoteJobs.length > 0) {
        console.log('[SyncEngine] Re-rendering after pulling jobs');
        if (window.render && typeof window.render === 'function') {
          window.render(true); // soft update
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
    const status = this.supabase.getStatus();
    if (!this.supabase.isOnline || !status.isAuthenticated || !this.supabase.userId) {
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
    const status = this.supabase.getStatus();
    if (!this.supabase.isOnline || !status.isAuthenticated || !this.supabase.userId) {
      console.log('[SyncEngine] Offline, skipping push');
      return;
    }

    console.log('[SyncEngine] Pushing local jobs');
    try {
      // Use app.js state if available, otherwise use modular state
      const localJobs = (window.state && window.state.jobs) ? window.state.jobs : this.state.jobs;
      const activeUserId = this.supabase.userId;
      const scopedJobs = localJobs.filter(job => !job.user_id || job.user_id === activeUserId);
      console.log('[SyncEngine] Pushing', scopedJobs.length, 'jobs from', window.state ? 'app.js' : 'modular', 'state');
      
      for (const localJob of scopedJobs) {
        if (!localJob.user_id) {
          localJob.user_id = activeUserId;
        }

        // Check if job exists remote
        const remoteJob = await this.supabase.select('jobs', {
          eq: { id: localJob.id, user_id: activeUserId }
        });

        if (!remoteJob || remoteJob.length === 0) {
          // New job - insert
          const jobData = this.prepareJobForCloud(localJob);
          console.log('[SyncEngine] Inserting new job:', localJob.id, 'type:', jobData.job_type);
          const result = await this.supabase.insert('jobs', jobData);
          
          if (result.success) {
            console.log(`[SyncEngine] ✓ Pushed new job: ${localJob.id}`);
            // Mark as synced
            localJob.synced_at = new Date().toISOString();
            if (window.state) {
              localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
            }
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
              if (window.state) {
                localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
              }
            }
          }
        }
      }

      // Push deletions to Supabase
      const deletedJobIds = (window.state && window.state.deletedJobIds) ? [...window.state.deletedJobIds] : [];
      if (deletedJobIds.length > 0) {
        console.log('[SyncEngine] Pushing', deletedJobIds.length, 'deleted jobs to cloud');
        const successfullyDeleted = [];
        
        for (const deletedId of deletedJobIds) {
          try {
            const result = await this.supabase.delete('jobs', { id: deletedId, user_id: activeUserId });
            if (result.success) {
              console.log(`[SyncEngine] ✓ Deleted job from cloud: ${deletedId}`);
              successfullyDeleted.push(deletedId);
            } else {
              console.warn(`[SyncEngine] ✗ Failed to delete job ${deletedId}:`, result);
            }
          } catch (error) {
            console.warn(`[SyncEngine] ✗ Delete error for ${deletedId}:`, error);
          }
        }
        
        // Only remove successfully deleted IDs from tracking
        if (window.state && successfullyDeleted.length > 0) {
          window.state.deletedJobIds = window.state.deletedJobIds.filter(
            id => !successfullyDeleted.includes(id)
          );
          localStorage.setItem('nx_deleted_job_ids', JSON.stringify(window.state.deletedJobIds));
          console.log(`[SyncEngine] ✓ Cleared ${successfullyDeleted.length} deletion(s) from tracking`);
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
   * Full bi-directional sync - PUSH deletions FIRST to prevent pull-back race condition
   */
  async fullSync() {
    console.log('[SyncEngine] fullSync called - isSyncing:', this.isSyncing, 'isOnline:', this.supabase.isOnline);
    const status = this.supabase.getStatus();
    
    if (this.isSyncing || !this.supabase.isOnline || !status.isAuthenticated || !this.supabase.userId) {
      console.log('[SyncEngine] Sync skipped - already in progress or offline');
      return;
    }

    this.isSyncing = true;
    console.log('[SyncEngine] Starting full sync');
    
    try {
      console.log('[SyncEngine] Step 1: Push local jobs (including deletions) FIRST');
      await this.pushLocalJobs();
      
      console.log('[SyncEngine] Step 2: Pull remote jobs after push completes');
      const pullResult = await this.pullRemoteJobs();
      console.log('[SyncEngine] Pull result:', pullResult);
      
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
    const status = this.supabase.getStatus();
    if (!this.supabase.isOnline || !status.isAuthenticated || !this.supabase.userId) {
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
        eq: { id: jobId, user_id: this.supabase.userId }
      });

      if (!Array.isArray(remoteJobs) || remoteJobs.length === 0) {
        // New job
        const jobData = this.prepareJobForCloud(localJob);
        const result = await this.supabase.insert('jobs', jobData);
        if (result.success) {
          localJob.synced_at = new Date().toISOString();
          if (window.state) {
            localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
          }
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
            if (window.state) {
              localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
            }
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
      if (window.state) {
        localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
      }
    }
  }

  /**
   * Check if local version should be pushed
   */
  shouldUpdate(localJob, remoteJob) {
    const localTime = new Date(localJob.updated_at || 0);
    const remoteTime = new Date(remoteJob.updated_at || 0);
    if (localTime > remoteTime) return true;

    // Fallback: push if timestamps are stale/missing but payload differs
    const localComparable = this.prepareJobForCloud(localJob);
    const comparableKeys = [
      'job_type', 'date', 'status', 'fee', 'base_fee', 'manual_fee', 'job_id_external',
      'notes', 'is_upgraded', 'saturday_premium',
      'elf', 'elf_added_by', 'elf_added_date',
      'candids', 'candids_reason', 'candids_added_by', 'candids_added_date',
      'chargeback', 'chargeback_reason', 'chargeback_amount', 'chargeback_week', 'chargeback_added_by', 'chargeback_added_date',
      'completed_at'
    ];

    return comparableKeys.some(key => {
      const localVal = localComparable[key] ?? null;
      const remoteVal = remoteJob[key] ?? null;
      return localVal !== remoteVal;
    });
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
    // Only work with app.js state - simplified approach
    let stateRef = window.state;
    
    if (!stateRef) {
      console.warn('[SyncEngine] window.state not available, checking for fallback...');
      // Fallback - try modular state
      if (this.state && this.state.jobs) {
        stateRef = { jobs: this.state.jobs };
      } else {
        console.error('[SyncEngine] No state available at all!');
        return false;
      }
    }

    if (!stateRef.jobs) {
      console.warn('[SyncEngine] No jobs array in state');
      return false;
    }

    let localJob = stateRef.jobs.find(j => j.id === remoteJob.id);

    if (!localJob) {
      // New remote job - create locally
      const newJob = this.reconstructJobFromCloud(remoteJob);
      stateRef.jobs.push(newJob);
      
      // Update localStorage
      if (window.state) {
        localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
      }
      
      console.log(`[SyncEngine] ✓ Merged new job from ${source}: ${remoteJob.id}`);
      return true; // change detected
    } else {
      // Update if remote is newer
      const localTime = new Date(localJob.updated_at || 0);
      const remoteTime = new Date(remoteJob.updated_at || 0);

      if (remoteTime > localTime) {
        console.log(`[SyncEngine] Updating job ${remoteJob.id} - remote is newer (remote: ${remoteTime.toISOString()}, local: ${localTime.toISOString()})`);
        const updatedJob = this.reconstructJobFromCloud(remoteJob);
        Object.assign(localJob, updatedJob);
        
        if (window.state) {
          localStorage.setItem('nx_jobs', JSON.stringify(window.state.jobs));
        }
        
        console.log(`[SyncEngine] ✓ Merged update from ${source}: ${remoteJob.id}`);
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
      user_id: remoteJob.user_id,
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
    if (this.periodicSyncId) {
      clearInterval(this.periodicSyncId);
    }

    console.log(`[SyncEngine] Starting periodic sync every ${this.syncInterval}ms`);
    this.periodicSyncId = setInterval(async () => {
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
