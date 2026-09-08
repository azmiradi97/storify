import { EtaClient } from './eta.client'
import { buildEtaPayload, type EtaPayloadParams } from './eta.payload'
import { serializeCanonical, signWithPem, buildSignatureBlock } from './eta.signer'
import { decrypt } from '@/shared/utils/encryption'

export interface EtaSubmitParams {
  invoiceId: string
  payloadParams: EtaPayloadParams
  tenantSettings: {
    eta_taxpayer_id: string
    eta_activity_code: string
    eta_branch_code: string
    eta_client_id: string          // encrypted
    eta_client_secret: string      // encrypted
    eta_signing_cert_pem?: string  // encrypted (or null if HSM)
    eta_enabled: boolean
    is_production?: boolean
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
}

export interface EtaSubmitResult {
  success: boolean
  etaUuid?: string
  etaLongId?: string
  etaStatus: 'accepted' | 'rejected' | 'failed'
  etaError?: object
  submissionId?: string
}

export async function submitInvoiceToEta(params: EtaSubmitParams): Promise<EtaSubmitResult> {
  const { invoiceId, payloadParams, tenantSettings, db } = params

  const clientId = decrypt(tenantSettings.eta_client_id)
  const clientSecret = decrypt(tenantSettings.eta_client_secret)

  const client = new EtaClient(clientId, clientSecret, tenantSettings.is_production ?? false)

  // ETA-02: the attempt number is the next in sequence for this invoice, so a
  // resubmission after a rejection is distinguishable from the first try in the
  // eta_submissions audit trail (previously every row was hard-coded to 1).
  const attemptRows = (await db.$queryRawUnsafe(
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS n FROM eta_submissions WHERE invoice_id = $1`,
    invoiceId,
  )) as Array<{ n: number | bigint }>
  const attemptNumber = Number(attemptRows[0]?.n ?? 1)

  const document = buildEtaPayload(payloadParams)
  const serialized = serializeCanonical(document)

  let signedDocument: object = document
  if (tenantSettings.eta_signing_cert_pem) {
    const privateKeyPem = decrypt(tenantSettings.eta_signing_cert_pem)
    const sigResult = signWithPem(serialized, privateKeyPem)
    const sigBlock = buildSignatureBlock(sigResult)
    signedDocument = { ...document, signatures: [sigBlock] }
  }

  let response
  try {
    response = await client.submitDocuments([signedDocument])
  } catch (err) {
    await db.$executeRawUnsafe(`
      INSERT INTO eta_submissions (id, invoice_id, attempt_number, status, request_payload, error_message, created_at)
      VALUES (gen_random_uuid(), $1, ${attemptNumber}, 'failed', $2::jsonb, $3, NOW())
    `, invoiceId, JSON.stringify(signedDocument), String(err))

    return { success: false, etaStatus: 'failed', etaError: { message: String(err) } }
  }

  const accepted = response.acceptedDocuments.find(
    (d) => d.internalId === payloadParams.invoice.invoiceNumber,
  )
  const rejected = response.rejectedDocuments.find(
    (d) => d.internalId === payloadParams.invoice.invoiceNumber,
  )

  if (accepted) {
    await db.$executeRawUnsafe(`
      INSERT INTO eta_submissions (id, invoice_id, attempt_number, status, submission_id, request_payload, response_body, eta_uuid, created_at)
      VALUES (gen_random_uuid(), $1, ${attemptNumber}, 'accepted', $2, $3::jsonb, $4::jsonb, $5, NOW())
    `, invoiceId, response.submissionId, JSON.stringify(signedDocument), JSON.stringify(response), accepted.uuid)

    return {
      success: true,
      etaUuid: accepted.uuid,
      etaLongId: accepted.longId,
      etaStatus: 'accepted',
      submissionId: response.submissionId,
    }
  }

  const errDetail = rejected?.error ?? { code: 'UNKNOWN', message: 'Not in accepted or rejected list' }

  await db.$executeRawUnsafe(`
    INSERT INTO eta_submissions (id, invoice_id, attempt_number, status, submission_id, request_payload, response_body, error_message, created_at)
    VALUES (gen_random_uuid(), $1, ${attemptNumber}, 'rejected', $2, $3::jsonb, $4::jsonb, $5, NOW())
  `, invoiceId, response.submissionId ?? null, JSON.stringify(signedDocument), JSON.stringify(response), JSON.stringify(errDetail))

  return {
    success: false,
    etaStatus: 'rejected',
    etaError: errDetail,
    submissionId: response.submissionId,
  }
}
