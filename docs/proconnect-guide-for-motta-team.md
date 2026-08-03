# ProConnect API — A Plain-English Guide for the Motta Team

> **Who this is for.** Motta team members (tax, ops, leadership) who are *not*
> developers but need to understand what the ProConnect integration is, what it
> can do, and where it stands. No coding background assumed.
>
> **What this is not.** This is not the technical spec (that lives in
> `alfred-hub-proconnect-spec.md`). This is the "explain it like I'm not an
> engineer" version.
>
> Last updated: 2026-06-16 · This guide will be iterated.

---

## 1. What is an "API," in one paragraph?

An **API** is a way for two software systems to talk to each other directly,
without a human clicking buttons. Normally, to enter a client's wages into
ProConnect, a preparer logs in and types them into a screen. An API lets the
**Motta Hub** do that same thing automatically — read data out of ProConnect, or
write data into it — by sending structured messages over the internet. Think of
it as a "staff door" into ProConnect that software can use, instead of the normal
"front door" that people use.

Intuit is giving Motta **exclusive, early access** to ProConnect's API, and
they're releasing it in **phases** — we have to fully use what we've been given
before they unlock the next piece.

---

## 2. The two documents, explained simply

You have **two** Intuit documents. They are two different layers of the same
integration.

### Document A — the "Platform" doc (the original "Open API Doc")

This is the **foundation**. It covers the basic building blocks:

| What it lets us do | In plain terms |
|---|---|
| **Connect securely (OAuth)** | A one-time secure handshake where Motta's Primary Admin grants the Hub permission to act on the firm's ProConnect account. |
| **Manage Clients** | Read the list of clients, look one up, create a new one, or update an existing one — the *customer record* (name, address, SSN/EIN, etc.). |
| **Look up Tax Returns ("Engagements")** | See a client's returns for a given year, including their e-file status, lock status, and e-signature status. |
| **Create a Tax Return** | Spin up a new return for a client/year — including "rolling forward" last year's return (called **proforma**). |
| **Track Work Status** | Read ProConnect's custom status labels (e.g. "Not Started," "Refer to notes"). |
| **Webhooks** | ProConnect can *notify* the Hub automatically whenever a client, return, or status changes — so the Hub stays in sync without constantly asking. |

**In short:** Document A is about the *containers* — clients and returns — and
keeping them in sync between ProConnect and the Hub.

### Document B — the "Phase 1" doc (Series Map Export & Import)

This is the **new piece**, and it's about the *contents* of a return — the actual
field-by-field tax data. It has exactly **two** functions:

| Function | In plain terms |
|---|---|
| **Export** | Read *all* the data currently entered on a return — every field, its value, and a "version stamp." Like downloading a complete snapshot of what's been keyed in. |
| **Import** | Write data *into* a return — one "section" at a time. Like having software type the numbers onto the return for you. |

**Phase 1 only covers the 1040 (individual) return.** Business returns
(1120, 1065, etc.) come in later phases.

A few important built-in safety features of Import:
- **"Dry run" mode** — you can *test* an import to see if it would be accepted,
  **without actually writing anything.** Like spell-check before you hit send.
- **Partial success** — if you send 50 fields and 3 are wrong, the 47 good ones
  still go in and ProConnect tells you exactly which 3 failed and why.
- **It is not "undo-able" automatically** — sending the same import twice writes
  the data twice. So the Hub is careful never to send a write twice by accident.

---

## 3. The single most important thing to understand: the "catalog gap"

This is the concept that determines what's realistic right now, so it's worth
getting.

When you Import data, ProConnect doesn't accept "wages = $80,000." It accepts
codes like:

> **series `s11`, code `c43`** = `80000`

In other words, every box on the 1040 has a **numeric address** (a series, a
code, etc.). The Import function needs that address.

**The problem:** neither Intuit document tells us what the addresses *mean*. We
don't yet have the "dictionary" that says *"code c43 is wages,"* *"this series is
mortgage interest,"* and so on. Intuit calls that dictionary their internal
**catalog**, and it's expected to come in a **later phase** (or by asking Intuit
directly).

**What this means in practice:**

| We CAN do now | We CANNOT do yet |
|---|---|
| Connect to ProConnect | Know which code = which 1040 line, from scratch |
| Sync clients and returns | Auto-fill a full return without the dictionary |
| Create returns / roll forward | "Prepare a 1040 with zero manual input" (the end goal) |
| Read (Export) any return's data | |
| Write (Import) to codes we *do* know | |

**The workaround:** we can *learn* the dictionary piece by piece by having a
preparer fill out a sample 1040 by hand in ProConnect, then **Export** it and see
which codes got filled in. That's how we build our own partial dictionary while
waiting for Intuit's official one.

So the honest roadmap is:
1. **Now:** connect, sync, create returns, read/write known fields. ✅
2. **Next (needs the dictionary):** auto-map a W-2/1099 to the right codes.
3. **End goal:** ALFRED reads source documents and prepares the 1040 with no
   manual typing — a human just reviews and e-files.

---

## 4. What the integration gives Motta (the "so what")

When this is fully built, the Hub will be able to:

- Keep **one client list** in sync across ProConnect, Karbon, and the Hub — no
  double entry.
- **Create returns and roll them forward** automatically at the start of a
  season.
- Show a return's **e-file and signature status** inside the Hub (and on the
  client profile / ALFRED summary), so no one has to log into ProConnect to
  check.
- Eventually, have **ALFRED draft a 1040** from the client's documents, with a
  preparer reviewing rather than keying.

---

## 5. Important ground rules (why some things are slow or careful)

These come straight from Intuit's docs and shape how we build:

1. **There is no "practice" environment.** Unlike most software, ProConnect has
   no sandbox — every test happens against *real* returns. That's why we use
   "dry run" mode heavily and test only on dedicated dummy clients.
2. **Only the Primary Admin can connect.** The secure handshake must be done by
   the firm's ProConnect Primary Admin.
3. **Speed limit.** Intuit caps how fast we can send data (about 5 requests per
   second), so big imports are paced deliberately.
4. **Privacy.** SSNs/EINs and other sensitive data are never written to logs.
   ProConnect itself never echoes them back in error messages, and the Hub
   follows the same rule.

---

## 6. Where we stand today

- **Connection (OAuth):** built. ✅
- **Client & return sync:** built. ✅
- **Read (Export) a return:** built. ✅
- **Write (Import) to a return:** built (with dry-run + safety logic). ✅
- **Webhooks (auto-sync on changes):** built. ✅
- **The field dictionary (catalog):** *the main open item* — partially
  bootstrappable from sample returns; full version expected from Intuit. ⏳
- **A couple of technical details need confirmation from Intuit** (see the
  separate "Questions for ProConnect" list) before we can be 100% sure Export/
  Import will work against the live system.

---

## 7. Mini-glossary (plain English)

| Term | What it means |
|---|---|
| **API** | A "staff door" that lets software talk to ProConnect directly. |
| **OAuth** | The secure permission handshake to connect the Hub to ProConnect. |
| **Engagement** | Intuit's word for a tax return instance (one client, one year). |
| **Client / oiiClientId** | A customer record and its unique ID in ProConnect. |
| **Export** | Read all the data off a return. |
| **Import** | Write data onto a return. |
| **Series / Code** | The numeric "address" of a field on a return (e.g. the wages box). |
| **Catalog (IVCS/FRF)** | Intuit's master dictionary mapping codes → meanings. The big missing piece. |
| **Proforma** | Rolling last year's return forward as the starting point for this year. |
| **Dry run** | Test an import without actually saving anything. |
| **Webhook** | An automatic "heads up" ProConnect sends when something changes. |
| **Primary Admin** | The firm's top ProConnect account holder; the only one who can connect the API. |
| **Realm** | Intuit's word for "your firm's account." |

---

## 8. Where to go deeper

- Technical architecture & exact endpoints: `docs/alfred-hub-proconnect-spec.md`
- The two Intuit source PDFs (Platform doc + Phase 1 doc)
- Questions we still need Intuit to answer: see the "Questions for ProConnect"
  list maintained by the dev team.
