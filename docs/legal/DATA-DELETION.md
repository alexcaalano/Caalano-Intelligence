# Caalano360 Data Deletion

**DRAFT for legal review. Not yet published.** This page is the deletion instructions URL required by Meta App Review and Google OAuth verification, and the documented deletion path referred to in our Privacy Policy.

Caalano Digital Pty Ltd (ABN 31 670 857 397) operates Caalano360. This page explains how to have data deleted, what is deleted, and how long it takes.

## Delete your own account

If you have a Caalano360 login:

1. Sign in and open Settings → Users, or email alex@caalanodigital.com.au from the address on your account with the subject "Delete my account".
2. A Super Admin removes the account. Your profile, role, sign-in records and access log entries are deleted within 30 days.
3. Your Terms of Use acceptance record is kept for 7 years as evidence of the agreement, as the Privacy Policy explains.

## Delete a business's data (customer account)

If you are the owner or an admin of a business or agency using Caalano360:

1. Disconnect your connected accounts first, so nothing new arrives: Settings → CRM connection → Disconnect, and remove Caalano360 from your Meta and Google accounts (steps below).
2. Email alex@caalanodigital.com.au from an admin address with the subject "Delete our data" and the name of the business. [Planned: a Delete workspace button in Settings for organisation owners.]
3. Within 30 days we delete every record we hold for that business: contact and deal copies, snapshots, monthly reports, settings, connections and credentials, and the access and reliability log rows that name it.
4. Backups age out within a further [X] days, after which nothing remains.
5. We confirm completion by email.

## Delete one contact's data

Caalano360 holds copies of records whose source is your CRM. Delete or anonymise the contact in the CRM and our copy is removed at the next refresh, within 24 hours. Reports that were already generated hold only totals, not the contact. If you need the record gone sooner, email us with the CRM contact ID and we remove it the same business day.

If you are a contact of a business using Caalano360 and want your information removed, contact that business directly, or email us and we will pass your request to them within 5 business days and confirm to you when the record is gone from our systems.

## Remove Caalano360's access to Meta

1. Open facebook.com → Settings & privacy → Settings → Business integrations (or Apps and websites).
2. Find Caalano360 and choose Remove.

This revokes our access token immediately. Meta also sends us a deletion request, which removes the connection and any advertising data cached for it. [Planned in phase 3: the Meta data deletion callback endpoint at `/.netlify/functions/meta-data-deletion`, which returns a confirmation code and a status URL as Meta requires.] Alternatively, email us with the subject "Meta data deletion" and the name of the ad account.

## Remove Caalano360's access to Google

1. Open myaccount.google.com → Security → Third-party apps & services.
2. Find Caalano360 and choose Remove access.

Google Ads and Google Analytics data cached for that connection is removed within 30 days, or on request the same business day. Caalano360's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

## Remove Caalano360 from GoHighLevel

Agency admins can uninstall the app from the Agency → Marketplace → Installed apps screen, or per sub-account. Uninstalling revokes our token. Our copies of that sub-account's records are removed within 30 days, or on request the same business day.

## Questions

alex@caalanodigital.com.au. We answer deletion requests within 5 business days and complete them within 30 days.
