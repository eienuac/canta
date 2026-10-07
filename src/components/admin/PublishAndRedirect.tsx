'use client'

import {
  FormSubmit,
  toast,
  useConfig,
  useDocumentInfo,
  useForm,
  useFormModified,
  useLocale,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import { useCallback } from 'react'

/**
 * Product publish button: after a successful publish, new products go to a fresh
 * "create" form (to add the next one) and edits go back to the product list.
 */
export function PublishAndRedirect() {
  const { id, collectionSlug, hasPublishedDoc, hasPublishPermission, unpublishedVersionCount, uploadStatus } =
    useDocumentInfo()
  const { submit } = useForm()
  const modified = useFormModified()
  const { code: localeCode } = useLocale()
  const router = useRouter()
  const {
    config: {
      routes: { admin: adminRoute, api: apiRoute },
    },
  } = useConfig()

  const canPublish =
    hasPublishPermission &&
    (modified || unpublishedVersionCount > 0 || !hasPublishedDoc) &&
    uploadStatus !== 'uploading'

  const publish = useCallback(async () => {
    if (!collectionSlug || uploadStatus === 'uploading') return
    const isNew = !id

    const result = await submit({
      action: formatAdminURL({
        apiRoute,
        path: `/${collectionSlug}${id ? `/${id}` : ''}?depth=0&locale=${localeCode}`,
      }),
      method: isNew ? 'POST' : 'PATCH',
      overrides: { _status: 'published' },
      disableSuccessStatus: true,
    })

    if (!result?.res?.ok) return

    toast.success(isNew ? 'Ürün yayınlandı. Yeni ürün ekleyebilirsiniz.' : 'Değişiklikler yayınlandı.')
    router.push(
      formatAdminURL({
        adminRoute,
        path: `/collections/${collectionSlug}${isNew ? '/create' : ''}`,
      }),
    )
  }, [adminRoute, apiRoute, collectionSlug, id, localeCode, router, submit, uploadStatus])

  if (!hasPublishPermission) return null

  return (
    <FormSubmit buttonId="action-save" disabled={!canPublish} onClick={publish} size="medium" type="button">
      Yayınla
    </FormSubmit>
  )
}

export default PublishAndRedirect
