import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
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

const s3 = new S3Client({
  region: 'eu-west-2',
  credentials: creds
});


export async function proposeBlockUpload(bid: string, tid: string, oid: string, proposal: UploadProposal) {
  const key = `b/${bid}/t/${tid}/o/${oid}`;

  //todo is oid beyond track cursor???

  const cmd = new PutObjectCommand({
    Bucket: 'upis-data',
    Key: key,
    ContentLength: proposal.size,
    ContentMD5: proposal.hash,
    ContentType: proposal.mimeType
  });

  return {
    bid,
    tid,
    oid, 
    uploadUrl: await getSignedUrl(s3, cmd, { expiresIn: 3600 })
  } 
}

export function isUploadProposal(v: any): v is UploadProposal {
  return typeof v.size === 'number'
    && typeof v.hash === 'string'
    && typeof v.mimeType === 'string';
}

export type UploadProposal = {
  size: number,
  hash: string,
  mimeType: string
}


export async function createBand(user: User, bandName: string) {
  const bid = randomUUID();

  const r = await dynamo.send(new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: 'upis_bands',
          Item: {
            bid: { S: bid },
            sort: { S: 'band' },
            name: { S: bandName },
            nextTrackId: { N: '1' },
            v: { N: '0' }
          }
        }
      },
      {
        Put: {
          TableName: 'upis_bands',
          Item: {
            bid: { S: bid },
            sort: { S: `user/${user.uid}` },
            name: { S: user.name },
          }
        }
      },
      {
        Put: {
          TableName: 'upis_users',
          Item: {
            uid: { S: user.uid },
            sort: { S: `band/${bid}` },
            name: { S: bandName },
          }
        }
      },
      {
        Update: {
          TableName: 'upis_users',
          Key: { uid: { S: user.uid }, sort: { S: 'user' } },
          UpdateExpression: 'SET v = v + :inc',
          ExpressionAttributeValues: {
            ':inc': { N: '1' }
          }
        }
      }
    ]
  }));

  console.log(r);
}

// //wouldn't have to claim if we went for time-based UUIDs here instead...
// //would save db interaction
// export async function claimTrackId(bid: string): Promise<string> {
//   const r = await dynamo.send(new UpdateItemCommand({
//     TableName: 'upis_bands',
//     Key: { bid: { S: bid }, sort: { S: 'band' } },
//     UpdateExpression: 'SET nextTrackId = nextTrackId + :inc',
//     ExpressionAttributeValues: {
//       ':inc': { N: '1' }
//     },
//     ReturnValues: 'UPDATED_OLD'
//   }));

//   const claimed = r.Attributes?.nextTrackId?.N;
//   if(!claimed) throw 'Claimed number not returned';

//   return claimed;
// }

export async function createTrack(bid: string, tid: string) {
  const r = await dynamo.send(new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: 'upis_tracks',
          Item: {
            'bid:tid': { S: `${bid}:${tid}` },
            sort: { S: 'track' },
            v: { N: '0' }
          }
        }
      },
      {
        Put: {
          TableName: 'upis_bands',
          Item: {
            bid: { S: bid },
            sort: { S: `track/${tid}` },
          }
        }
      },
      {
        Update: {
          TableName: 'upis_bands',
          Key: { bid: { S: bid }, sort: { S: 'band' } },
          UpdateExpression: 'SET v = v + :inc',
          ExpressionAttributeValues: {
            ':inc': { N: '1' }
          }
        }
      }
    ]
  }));

  return [bid, tid];
}



export async function userExists(uid: string): Promise<boolean> {
  const r = await dynamo.send(new GetItemCommand({
    TableName: 'upis_users',
    Key: { uid: { S: uid }, sort: { S: 'user' } },
    AttributesToGet: ['state']
  }));

  return !!r.Item;
}

export async function loadUser(uid: string): Promise<User|false> {
  const r = await dynamo.send(new QueryCommand({
    TableName: 'upis_users',
    KeyConditionExpression: 'uid = :uid',
    ExpressionAttributeValues: {
      ':uid': { S: uid }
    }
  }));
  // const r = await dynamo.send(new GetItemCommand({
  //   TableName: 'upis_users',
  //   Key: { uid: { S: uid }, sort: { S: 'user' } },
  //   AttributesToGet: ['state', 'bands']
  // }));

  console.log('Got', r.Items);

  const items = r.Items;
  if(!items) return false;

  const bands: Record<string, string> = {};
  let name: string = '';

  for(const item of items) {
    const sort = item.sort?.S;
    if(!sort) continue;

    if(sort == 'user') {
      const n = item.name?.S;
      if(n && typeof n === 'string') {
        name = n;
      }
      continue;
    }

    const matched = sort.match(/^band\/(?<bid>.+)/);
    if(matched && matched.groups) {
      const bid = matched.groups['bid'];

      const name = item.name?.S;
      if(name && typeof name === 'string') {
        bands[bid] = name;
      }
    }
  }

  return {
    uid,
    name,
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
        Action: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:Scan'
        ],
        Resource: 'arn:aws:dynamodb:eu-west-1:874522027524:table/upis_users',
        Condition: {
          "ForAllValues:StringEquals": {
              "dynamodb:LeadingKeys": [uid]
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
  name: string,
  bands: Record<string, string>
}
