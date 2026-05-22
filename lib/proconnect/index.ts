/**
 * ProConnect Integration Library
 *
 * Exports all ProConnect-related functionality:
 * - OAuth token management
 * - API client (clients, engagements, custom statuses)
 * - Sync orchestration
 */

// OAuth
export {
  getAccessToken,
  forceTokenRefresh,
  getTokenStatus,
  getRealmId,
} from "./oauth"

// API Client
export {
  fetchClients,
  fetchClient,
  fetchEngagements,
  fetchCustomStatuses,
  extractClientEmail,
  extractClientId,
  extractClientName,
  RETURN_TYPE_MAP,
} from "./client"

// Sync
export {
  runFullSync,
  getSyncStats,
  syncSingleClient,
  deleteClient,
} from "./sync"
