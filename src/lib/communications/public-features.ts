import {
  isCommunicationDraftGeneratorEnabled,
  isCommunicationScheduledSendsEnabled,
  isCommunicationsProviderEnabled,
  isTenantCommunicationsEnabled,
} from "./feature-flag";

/**
 * Safe, non-secret feature state for authenticated session clients.
 * Never includes tokens, Twilio credentials, or cron secrets.
 */
export type PublicCommunicationsFeatures = {
  tenantCommunicationsEnabled: boolean;
  communicationsProviderEnabled: boolean;
  draftGeneratorEnabled: boolean;
  scheduledSendsEnabled: boolean;
};

export function getPublicCommunicationsFeatures(): PublicCommunicationsFeatures {
  return {
    tenantCommunicationsEnabled: isTenantCommunicationsEnabled(),
    communicationsProviderEnabled: isCommunicationsProviderEnabled(),
    draftGeneratorEnabled: isCommunicationDraftGeneratorEnabled(),
    scheduledSendsEnabled: isCommunicationScheduledSendsEnabled(),
  };
}
