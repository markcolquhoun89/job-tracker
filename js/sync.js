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
    
    // Start periodic sync
    this.startPeriodicSync();
    return true;
  }

  /**
   * Pull jobs from Supabase
   */
  async pullRemoteJobs() {
    if (!this.supabase.isOnline) {
      console.log('[SyncEngine] Offline, skipping pull');
      return;
    }

    console.log('[SyncEngine] Pulling remote jobs');
    try {
      // Get all jobs for current user
      const remoteJobs = await this.supabase.select('jobs', {
        eq: { user_id: this.supabase.userId }
      });

      if (!Array.isArray(remoteJobs)) {
        console.warn('[SyncEngine] No remote jobs found or fetch failed');
        return;
      }

      console.log(`[SyncEngine] Pulled ${remoteJobs.length} remote jobs`);

      // Merge with local jobs using conflict resolution
      for (const remoteJob of remoteJobs) {
        await this.mergeJob(remoteJob, 'remote');
      }

    } catch (error) {
      console.error('[SyncEngine] Pull failed:', error);
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
      const localJobs = this.state.jobs;
      
      for (const localJob of localJobs) {
        // Check if job exists remote
        const remoteJob = await this.supabase.select('jobs', {
          eq: { id: localJob.id }
        });

        if (!remoteJob || remoteJob.length === 0) {
          // New job - insert
          const jobData = this.prepareJobForCloud(localJob);
          const result = await this.supabase.insert('jobs', jobData);
          
          if (result.success) {
            console.log(`[SyncEngine] Pushed new job: ${localJob.id}`);
            // Update local timestamp
            localJob.synced_at = new Date().toISOString();
            await this.db.saveJob(localJob);
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
              console.log(`[SyncEngine] Pushed update to job: ${localJob.id}`);
              localJob.synced_at = new Date().toISOString();
              await this.db.saveJob(localJob);
            }
          }
        }
      }

      // Update last sync time
      this.lastSyncTime = new Date();
      localStorage.setItem('nx_last_sync_time', this.lastSyncTime.toISOString());
      console.log('[SyncEngine] Push complete');

    } catch (error) {
      console.error('[SyncEngine] Push failed:', error);
    }
  }

  /**
   * Full bi-directional sync
   */
  async fullSync() {
    if (this.isSyncing || !this.supabase.isOnline) {
      console.log('[SyncEngine] Sync already in progress or offline');
      return;
    }

    this.isSyncing = true;
    console.log('[SyncEngine] Starting full sync');
    
    try {
      await this.pullRemoteJobs();
      await this.pushLocalJobs();
      console.log('[SyncEngine] Full sync complete');
    } catch (error) {
      console.error('[SyncEngine] Full sync failed:', error);
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
    return {
      id: job.id,
      user_id: this.supabase.userId,
      job_type: job.jobType,
      date: job.date,
      status: job.status,
      fee: job.fee,
      base_fee: job.baseFee,
      manual_fee: job.manualFee,
      job_id_external: job.jobId,
      notes: job.notes,
      is_upgraded: job.upgraded,
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
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Merge remote job into local state
   */
  async mergeJob(remoteJob, source = 'remote') {
    const localJob = this.state.getJob(remoteJob.id);

    if (!localJob) {
      // New remote job - create locally
      const newJob = this.reconstructJobFromCloud(remoteJob);
      this.state.jobs.push(newJob);
      await this.db.saveJob(newJob);
      console.log(`[SyncEngine] Merged new job from ${source}: ${remoteJob.id}`);
    } else {
      // Update if remote is newer
      const localTime = new Date(localJob.updated_at || 0);
      const remoteTime = new Date(remoteJob.updated_at || 0);

      if (remoteTime > localTime) {
        Object.assign(localJob, this.reconstructJobFromCloud(remoteJob));
        await this.db.saveJob(localJob);
        console.log(`[SyncEngine] Merged update from ${source}: ${remoteJob.id}`);
      }
    }
  }

  /**
   * Reconstruct job from cloud format to local format
   */
  reconstructJobFromCloud(remoteJob) {
    return {
      id: remoteJob.id,
      jobType: remoteJob.job_type,
      date: remoteJob.date,
      status: remoteJob.status,
      fee: remoteJob.fee,
      baseFee: remoteJob.base_fee,
      manualFee: remoteJob.manual_fee,
      jobId: remoteJob.job_id_external,
      notes: remoteJob.notes,
      upgraded: remoteJob.is_upgraded,
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
   * Start periodic sync timer
   */
  startPeriodicSync() {
    console.log(`[SyncEngine] Starting periodic sync every ${this.syncInterval}ms`);
    setInterval(() => {
      if (this.supabase.isOnline) {
        this.fullSync();
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
