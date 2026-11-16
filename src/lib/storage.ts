import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

export const buckets = {
  attachments: process.env.S3_BUCKET ?? 'attachments',
  recordings: 'recordings',
}

let client: S3Client | undefined
let ensured: Promise<void> | undefined

function s3() {
  client ??= new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  })
  return client
}

async function ensureBuckets() {
  for (const Bucket of Object.values(buckets)) {
    try {
      await s3().send(new HeadBucketCommand({ Bucket }))
    } catch {
      await s3().send(new CreateBucketCommand({ Bucket }))
    }
  }
}

export async function putObject(bucket: string, key: string, body: Uint8Array, contentType: string) {
  ensured ??= ensureBuckets()
  await ensured
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
}

export async function getObjectResponse(bucket: string, key: string, init: { fileName?: string; range?: string | null } = {}) {
  const obj = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: init.range ?? undefined }))
  const headers = new Headers({ 'cache-control': 'private, max-age=3600', 'accept-ranges': 'bytes' })
  if (obj.ContentType) headers.set('content-type', obj.ContentType)
  if (obj.ContentLength != null) headers.set('content-length', String(obj.ContentLength))
  if (obj.ContentRange) headers.set('content-range', obj.ContentRange)
  if (init.fileName) headers.set('content-disposition', `inline; filename="${encodeURIComponent(init.fileName)}"`)
  return new Response(obj.Body!.transformToWebStream(), { status: obj.ContentRange ? 206 : 200, headers })
}

export { ensureBuckets }
