# License Management

## Lifecycle
Issued → Active → (Expired | Revoked). Lifetime = no expiry.

## Activation Flow (future)
User activates on a machine → activations++ → block when activations = maxActivations.

## Renewal Flow (future)
expiresAt - today <= RENEWAL_WARNING_DAYS → show Renew → payment → extend expiresAt, status=active.

## Future API
license-management.service methods me Supabase/REST calls daalo. UI same rahega.
Key masking UI-side; real key server se on-demand.