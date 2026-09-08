import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './env'

export const r2Client = config.R2_ACCOUNT_ID
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID ?? '',
        secretAccessKey: config.R2_SECRET_ACCESS_KEY ?? '',
      },
    })
  : null

// Returns a presigned PUT URL + the final public URL (client uploads directly to R2)
export async function getUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  if (!r2Client || !config.R2_BUCKET_NAME) {
    throw new Error('R2 not configured')
  }
  const command = new PutObjectCommand({
    Bucket: config.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  })
  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds })
  const publicUrl = `${config.R2_PUBLIC_URL}/${key}`
  return { uploadUrl, publicUrl }
}

// API-02: returns a short-lived presigned GET URL for a stored object. This is
// what lets sensitive documents (customer national-IDs, installment signatures)
// live in a PRIVATE bucket — the client fetches a signed, expiring URL on demand
// instead of relying on a permanent public URL. (The bucket must be flipped to
// private in the R2 dashboard for this to actually restrict access — an ops
// step that pairs with this code.)
export async function getDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
  if (!r2Client || !config.R2_BUCKET_NAME) {
    throw new Error('R2 not configured')
  }
  const command = new GetObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key })
  return getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds })
}

// Recover the object key from a stored public URL (`${R2_PUBLIC_URL}/<key>`) so
// existing rows — which recorded the public URL, not the key — can still be
// presigned without a data migration. Returns null for legacy/external URLs.
export function keyFromPublicUrl(publicUrl: string): string | null {
  const base = config.R2_PUBLIC_URL
  if (!base) return null
  const prefix = base.endsWith('/') ? base : `${base}/`
  return publicUrl.startsWith(prefix) ? publicUrl.slice(prefix.length) : null
}
