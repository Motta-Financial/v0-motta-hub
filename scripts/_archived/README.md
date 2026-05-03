# Archived Scripts

This directory contains one-time migration and import scripts that have been executed and are no longer needed for regular operations.

## Archived on 2026-05-03

These scripts were used during initial data migration and setup. They are kept for reference but should not be run again unless you understand their purpose.

### Backfill Scripts
- `backfill-comprehensive-linkage.ts` - One-time script to link records across tables
- `backfill-ignition-proposal-clients.ts` - One-time script to associate proposals with clients
- `create-missing-client-entities.ts` - One-time script to create missing client records

### Import Scripts
- `import-hubspot-invoices.ts` - HubSpot invoice import (historical)
- `import-ignition-outstanding-invoices.mjs` - Ignition invoice import (historical)
- `import-jotform-debriefs.ts` - JotForm debrief import (historical)
- `import-karbon-organizations.ts` - Karbon organization import (historical)
- `import-tommy-ballots.ts` - Tommy Awards ballot import (historical)

### Data Scrub Scripts
- `scrub-contacts-from-karbon-csv.ts` - CSV processing (historical)
- `scrub-ignition-from-csvs.ts` - CSV processing (historical)
- `scrub-organizations-from-karbon-csv.ts` - CSV processing (historical)
- `scrub-work-items-from-karbon-csv.ts` - CSV processing (historical)

### User Setup Scripts
- `add-caleb-amy-users.ts` - One-time user creation

### Data Migration Scripts
- `003-merge-pereira-and-dedupe-weeks.ts/.mjs` - Tommy Awards data fix
- `enrich-debriefs-from-karbon.mjs` - Debrief enrichment (historical)

## Active Scripts

The following scripts remain in the parent directory and may be needed for ongoing operations:
- `sync-karbon-fullnames.ts` - Syncs full names from Karbon
- `sync-work-statuses.ts` - Syncs work statuses from Karbon
