import { harness } from '../payment-harness'

export const getSupabaseAdmin = () => harness.db.client
