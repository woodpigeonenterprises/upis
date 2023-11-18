import { Observable, ReplaySubject, combineLatest, concatMap, from, interval, map, merge, scan, startWith } from "rxjs";
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
  private tracks = new ReplaySubject<Track>();

  constructor(store:Store, jobs: JobQueue) {
    this.store = store;
    this.jobs = jobs;
  }

  getTracks(bid: string): Observable<Track[]> {
    return combineLatest([
      interval(10000).pipe(
        startWith(0),
        concatMap(() =>
          from(this.store.loadTracks(bid)).pipe(
            map(r => r.map(p => Track.init(
              p.info,
              this.store,
              this.jobs,
              x => [
                new Playable(x, () => this.store.loadBlobs({ stream: p.info.tid, idx: 0 }).pipe(map(sb => sb.blob))),
                p.persistState
              ]
            )))
          )),
        startWith([])
      ),
      this.tracks.pipe(
        scan((ac, t) => [...ac, t], <Track[]>[]),
        startWith([])
      )
    ]).pipe(
      map(([l, r]) => [...l, ...r])
    );
  }

  //todo the track should be aggregated into the expected band!
  add(track:Track) {
    console.info('ADD TRACK')
    this.tracks.next(track);
  }


  // async setBand(bid: string, sink:()=>void): Promise<void> {
  //   if(bid == this.bid) return;

  //   this.bid = bid;

  //   const allLoaded = await this.store.loadTracks(bid);

  //   this.tracks = allLoaded
  //     .map(p => Track.init(
  //       p.info,
  //       this.store,
  //       this.jobs,
  //       x => [
  //         new Playable(x, () => this.store.loadBlobs({ stream: p.info.tid, idx: 0 }).pipe(map(sb => sb.blob))),
  //         p.persistState
  //       ]
  //     ));

  //   // so with band set
  //   // we should start loading from dynamo
  //   // can imagine a stream of renderables being returned
  //   // in true reactive style
  //   //
  //   // this would replace the sink func
  //   // and would be joined into 
  //   //
  // }

  // unsetBand() {
  //   this.bid = undefined;
  //   this.tracks = [];
  // }

  // list() {
  //   return this.tracks;
  // }
}
