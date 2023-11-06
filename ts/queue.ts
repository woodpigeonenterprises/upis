import { openDB } from "idb";
import { delay, uuid } from "./util";

type JobId = string;

type JobOpts = {
  due?: number
};

export type JobHandler = (job: unknown) => Promise<boolean|number>;

export interface JobQueue {
  running: Promise<void>
  addJob(job: unknown, opts?: JobOpts): Promise<JobId>
};

export async function runJobQueue(name: string, handler: JobHandler): Promise<JobQueue> {
  const db = await openDB(`jobs_${name}`, 1, {
    upgrade(db, oldVersion, newVersion) {
      switch(`${oldVersion} -> ${newVersion}`) {
        case '0 -> 1':
          const s = db.createObjectStore('jobs', { keyPath: 'id' });
          s.createIndex('pending', ['due', 'queued']);
          break;
      }
    }
  });

  return {
    running: _run(),

    async addJob(job: unknown, opts?: JobOpts): Promise<JobId> {
      const jobId = uuid();
      
      const result = await db.put('jobs', {
        id: jobId,
        queued: Date.now(),
        due: opts?.due ?? 0,
        job
      });

      console.log('Added job', job, result);

      return jobId;
    }
  }

  async function _run(): Promise<void> {
    const parallelism = 5;
    const interval = 1000;
    const timeout = 1000 * 60 * 5;

    while(true) {
      const now = Date.now();
      
      const found = await db.getAllFromIndex(
        'jobs',
        'pending',
        IDBKeyRange.upperBound([now, now]),
        parallelism
      );

      // console.log('Found jobs', found);

      if(found.length > 0) {
        const tx = db.transaction('jobs', 'readwrite');

        await Promise.all([
          ...found.map(i => tx.store.put({ ...i, due: now + timeout })),
          tx.commit(),
          tx.done
        ]);

        await Promise.all(found.map(async i => {
          const job = i.job;

          const result = await handler(job);

          if(result === true) {
            await db.delete('jobs', i.id);
          }
          else if(typeof result === 'number') {
            await db.put('jobs', { ...i, due: Date.now() + result });
          }
          else {
            console.warn(`Handler refuses job ${job}`);
          }
        }));
      }
      else {
        await delay(interval);
      }

      // wot about locking?
      // TODO use WebLock API to lock !!!!!
      // (we did https especially for this!)
    }
  }
  
}




