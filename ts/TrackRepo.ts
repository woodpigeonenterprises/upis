import { Track } from "./record";
import { Store } from "./store";

export default class TrackRepo {
  private bid: string|undefined = undefined;
  private store: Store;
  private tracks: Track[] = [];

  constructor(store:Store) {
    this.store = store;
  }

  setBand(bid: string, sink:()=>void) {
    if(bid == this.bid) return;

    this.bid = bid;
    this.tracks = [];
    //start populating here!
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
