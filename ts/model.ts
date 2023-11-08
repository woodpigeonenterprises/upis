import { AwsCreds } from "../api/src/users";

export type Session = {
  uid: string,
  awsCreds: AwsCreds,
  expires: number
};

export type User = {
  uid: string
  name: string,
  bands: Map<string, string>
}

export type Band = {
  bid: string,
  name: string
}
