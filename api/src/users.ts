import { DynamoDBClient, GetItemCommand, PutItemCommand, TransactWriteItemsCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { err } from "./util.js";
import { randomUUID } from "crypto";

const creds = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || err('Missing AWS_ACCESS_KEY_ID'),
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || err('Missing AWS_SECRET_ACCESS_KEY')
};

const sts = new STSClient({
  region: 'eu-west-1',
  credentials: creds
});

const dynamo = new DynamoDBClient({
  region: 'eu-west-1',
  credentials: creds
});

export async function createBand(uid: string, name: string) {
  const bid = randomUUID();

  const r = await dynamo.send(new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: 'upis',
          Item: {
            key: { S: `band/${bid}` },
            users: { SS: [uid] },
            name: { S: name },
            nextTrackId: { N: '1' }
          }
        }
      },
      {
        Update: {
          TableName: 'upis',
          Key: { key: { S: `user/${uid}` }},
          UpdateExpression: 'SET bands.#bid = :bandName',
          ExpressionAttributeNames: {
            '#bid': bid
          },
          ExpressionAttributeValues: {
            ':bandName': { S: name }
          }
        }
      }
    ]
  }));

  console.log(r);
}

//wouldn't have to claim if we went for time-based UUIDs here instead...
//would save db interaction
export async function claimTrackId(bid: string): Promise<string> {
  const r = await dynamo.send(new UpdateItemCommand({
    TableName: 'upis',
    Key: { key: { S: `band/${bid}` } },
    UpdateExpression: 'SET nextTrackId = nextTrackId + :inc',
    ExpressionAttributeValues: {
      ':inc': { N: '1' }
    },
    ReturnValues: 'UPDATED_OLD'
  }));

  const claimed = r.Attributes?.nextTrackId?.N;
  if(!claimed) throw 'Claimed number not returned';

  return claimed;
}

export async function createTrack(bid: string, tid: string) {
  const r = await dynamo.send(new PutItemCommand({
    TableName: 'upis',
    Item: { key: { S: `track/${bid}/${tid}` } }
  }));

  // if a track is created, we can find it via query based on band
  // tracks should be queried in descending order
  // given STS for particular band (should be an extended session)

  return 'BLAH';
}



export async function userExists(uid: string): Promise<boolean> {
  const r = await dynamo.send(new GetItemCommand({
    TableName: 'upis',
    Key: { key: { S: `user/${uid}` } },
    AttributesToGet: ['state']
  }));

  return !!r.Item;
}

export async function loadUser(uid: string): Promise<User|false> {
  const r = await dynamo.send(new GetItemCommand({
    TableName: 'upis',
    Key: { key: { S: `user/${uid}` } },
    AttributesToGet: ['state', 'bands']
  }));

  console.log('Got', r.Item);

  const item = r.Item;
  if(!item) return false;

  const bands = item.bands?.M;
  if(!bands) return false;

  return {
    uid,
    bands,
    state: {}
  }
}


export async function getUserAwsCreds(uid: string): Promise<AwsCreds> {
  const r = await sts.send(new AssumeRoleCommand({
    RoleSessionName: uid,
    RoleArn: 'arn:aws:iam::874522027524:role/UpisUser',
    DurationSeconds: 900,
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: {
        Effect: 'Allow',
        Action: 'dynamodb:GetItem',
        Resource: 'arn:aws:dynamodb:eu-west-1:874522027524:table/upis',
        Condition: {
          "ForAllValues:StringEquals": {
              "dynamodb:LeadingKeys": [
                `user/${uid}`
              ]
          }
        }
      }
    })
  }));

  if(!r.Credentials) err(`Failed to assume role for ${uid}`);

  return {
    accessKeyId: r.Credentials.AccessKeyId || err('No AccessKeyId'),
    secretAccessKey: r.Credentials.SecretAccessKey || err('No SecretAccessKey'),
    sessionToken: r.Credentials.SessionToken || err('No SessionToken'),
    expires: r.Credentials.Expiration?.valueOf() || err('No Expiration')
  };
}

export type AwsCreds = {
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  expires: number
}

export type User = {
  uid: string,
  state: unknown,
  bands: Record<string, unknown>
}

