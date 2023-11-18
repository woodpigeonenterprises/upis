import { from, map } from "rxjs";
import { JobQueue } from "./queue";
import { Playable, Track } from "./record";
import { Store } from "./store";

// somehow we should be asking the store for tracks with regularity
//
//

export default class TrackRepo {
  private bid: string|undefined = undefined;
  private store: Store;
  private jobs: JobQueue;
  private tracks: Track[] = [];

  constructor(store:Store, jobs: JobQueue) {
    this.store = store;
    this.jobs = jobs;
  }

  async setBand(bid: string, sink:()=>void): Promise<void> {
    if(bid == this.bid) return;

    this.bid = bid;

    const allLoaded = await this.store.loadTracks(bid);

    this.tracks = allLoaded
      .map(p => Track.init(
        p.info,
        this.store,
        this.jobs,
        x => [
          new Playable(x, () => this.store.loadBlobs({ stream: p.info.tid, idx: 0 }).pipe(map(sb => sb.blob))),
          p.persistState
        ]
      ));
  }

  unsetBand() {
    this.bid = undefined;
    this.tracks = [];
  }

  add(track:Track) {
    this.tracks.push(track);
  }

  list() {
    return this.tracks;
  }
}
