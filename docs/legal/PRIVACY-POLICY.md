# Caalano360 Privacy Policy

**DRAFT for legal review. Not yet published.** Square brackets mark facts to confirm before publishing.

Caalano Digital Pty Ltd (ABN 31 670 857 397) ("Caalano Digital", "we", "us") operates Caalano360, a reporting platform that joins advertising results to what happened in a business's customer relationship management system (CRM). This policy explains what personal information we collect, why, where it goes, how long we keep it and how to have it corrected or deleted. It is written to meet the Australian Privacy Principles (APPs) in the *Privacy Act 1988* (Cth), the Notifiable Data Breaches scheme in Part IIIC of that Act, and the platform-policy requirements of Meta and Google.

Effective date: [date]. Last updated: [date]. Version 1.0.

## 1. Who this policy covers

Caalano360 holds information about three groups of people:

- **Account holders**: people who sign in to Caalano360, whether they work for Caalano Digital, for an agency using the platform, or for a business viewing its own reporting.
- **Contacts of our customers**: the leads, enquiries, patients and clients recorded in a customer's CRM and advertising accounts. We hold this information on behalf of the customer whose systems it came from. That customer decides what is collected and why; we process it under their instructions and our Data Processing Agreement.
- **Visitors** to our website and sign-in page.

Caalano Digital has elected to be treated as an organisation bound by the *Privacy Act 1988* for all of its handling of personal information, regardless of turnover. [Confirm: lodge the opt-in under section 6EA, or confirm the small business exemption does not apply because customers include providers of health services whose contact data includes health information.]

## 2. What we collect

**From account holders**

- First name, last name, email address and mobile phone number. All four are required to hold an account, so that verification codes can be sent to you by email or text message.
- A password, stored only as a salted hash. We never see or store the password itself.
- Your role and which customer accounts you may see.
- Sign-in records: the time of each sign-in, the IP address, and the city, region and country our hosting provider derives from it. We keep the last 30 sign-ins.
- Your acceptance of the Terms of Use: the version accepted, the time, your IP address and browser, and either a drawn signature image or your typed name.
- An access log of which screens, customer accounts and tabs you opened and for how long. This is a navigation log, not a record of individual clicks or keystrokes. It exists so a customer can see who looked at their data.
- Support correspondence with us.

**About contacts, on behalf of our customers**

When a customer connects a CRM (currently GoHighLevel, which some customers know under a white label such as Caalano Systems), we read and hold copies of the records needed for reporting:

- Contact names, email addresses, phone numbers and postcodes or suburbs (postcodes are used for the lead-location map).
- Opportunities and deals: pipeline, stage, value, source, created and closed dates, won or lost status and the recorded lost reason.
- Appointments: booked, attended, cancelled and no-show status and times.
- Form submissions and the answers to qualification questions.
- Notes, tags and custom fields recorded against a contact.
- Conversation history: SMS, email and chat messages between the business and the contact, and call records including duration and, where the CRM provides them, recordings or transcripts.
- Which CRM user is assigned to a contact.

Where the customer is a health service, such as a clinic, these records may include **health information**, which the Privacy Act treats as sensitive information: for example, an enquiry about an assessment or treatment. We treat all contact data as if it were sensitive.

**From advertising and analytics accounts, on behalf of our customers**

Campaign, ad set and ad names, spend, impressions, clicks, leads, conversions, creative thumbnails and, where available, ad video transcripts, from Meta Ads, Google Ads and Google Analytics 4, and organic reach and follower figures from Instagram and Facebook Pages. Today these come through Windsor.ai, a data pipeline provider; we are moving to direct connections. Advertising data is aggregate and does not identify contacts, except that Google Analytics and Meta lead forms may carry a lead's form answers.

**From website visitors**

Standard server logs: IP address, browser and page requested, kept by our hosting provider for security. We do not use advertising cookies or third-party analytics on the sign-in page. [Confirm once the public site is built.]

## 3. Why we collect it and how we use it

We use personal information to:

- provide the reporting the customer has asked for: joining ad spend to leads, bookings, sales and revenue, scoring lead quality, showing speed to lead and where deals stall;
- let a customer's sales team see and act on their own leads, including replying to a message or updating a deal, which is written back to the customer's CRM;
- produce written insights. Aggregated performance figures, campaign and ad names, recorded lost reasons and a small sample of CRM note text are sent to an AI provider (Anthropic) to draft commentary. We instruct the provider not to name individuals and we do not send contact names, email addresses, phone numbers or message content. Note text may incidentally contain personal details; customers can turn insights off. [Planned: AI grading of sales calls from CRM transcripts. This will be a separate, opt-in setting per customer and will be added to this policy before it is used.]
- keep the platform secure, including the sign-in and access logs above;
- keep the platform reliable: a technical log of requests, timings and errors that names the customer account but not contacts;
- meet our legal obligations and, later, to bill for subscriptions.

We do not sell personal information. We do not use contact data to build profiles for our own marketing, to train AI models, or for any purpose other than the customer's reporting.

## 4. Legal basis and consent

For account holders, we collect information directly from you when you accept an invitation and sign in. For contacts, the customer is responsible for having collected the information lawfully and for any notice or consent their contacts need under APP 3 and APP 5. Our Data Processing Agreement requires this.

## 5. Where the information goes: sub-processors

We use these providers to run Caalano360. Each one only receives what its role needs.

| Provider | Role | Location of data |
|---|---|---|
| Netlify, Inc. | Website hosting, serverless functions, edge sign-in gate, file storage for configuration and cached data | United States, with delivery from a worldwide edge network |
| Neon, Inc. | Postgres database | Sydney, Australia |
| GitHub, Inc. | Source code and encrypted [confirm: currently unencrypted, private repository] daily backups of configuration and account data | United States |
| Windsor.ai | Advertising and analytics data pipeline (being phased out) | European Union [confirm] |
| Anthropic, PBC | AI drafting of insights, as described in section 3 | United States |
| Meta Platforms and Google LLC | Sources of advertising and analytics data, and destination of any conversion data a customer asks us to send | United States |
| LeadConnector / HighLevel Inc. | The CRM the customer connects; we read from and write to it on the customer's instruction | United States |
| [Railway Corp.] | Planned: background processing service | Sydney, Australia |
| [Stripe, Inc.] | Planned: subscription billing (card details never touch our systems) | United States and Australia |

Some of these providers are outside Australia, so information is disclosed overseas within the meaning of APP 8. Before using each provider we satisfy ourselves that it is bound by contractual and technical protections at least as strong as the APPs, and we remain accountable for their handling of the information. We publish this list at [URL] and update it before adding a provider; customers on our Data Processing Agreement are notified in advance.

## 6. How we protect it

- All connections use TLS. Credentials for connected systems are encrypted at rest with per-record keys wrapped by a master key held only in our hosting provider's secret store.
- Every customer's data is isolated in the database by row-level security enforced by the database itself, not only by application code.
- Access to production systems is limited to named Caalano Digital staff with multi-factor authentication. Each account holder sees only the customer accounts assigned to them.
- Daily backups, tested restore procedures, and a written security backlog that is reviewed each release.
- Staff and customers accept Terms of Use that prohibit accessing or sharing data that is not theirs.

## 7. How long we keep it

| Information | Kept for |
|---|---|
| Account holder profile and role | While the account exists, then removed within 30 days of deletion |
| Sign-in records | Last 30 sign-ins |
| Terms acceptance records | 7 years after the account is closed, as evidence of the agreement |
| Access log (who opened what) | 90 days |
| Technical reliability log | 60 days |
| Contact and deal records copied from a CRM | Rolling window of 13 to 37 months depending on the customer's plan; a contact deleted in the CRM disappears from our copy at the next refresh, within 24 hours |
| Health-score and clinic snapshots | 400 days |
| Monthly reports and saved settings | While the customer's subscription is active, then 30 days |
| Backups | [X] days, after which deleted records are gone from every copy |

When a customer ends their subscription, all of their data is deleted within 30 days and from backups within a further [X] days, unless we are required by law to keep it.

## 8. Your rights: access, correction, deletion

Account holders can see and change their name and password in the app and can ask us for a copy of the information we hold about them. Customers can export their data and can delete their account and all of its data by following the steps on our Data Deletion page at [URL].

Contacts of a customer should direct requests to that customer, whose CRM is the source of the record. If a contact writes to us directly we will pass the request to the customer within 5 business days and help them act on it, and we will confirm to the contact once the record is removed from our systems.

We respond to access and correction requests within 30 days, as APP 12 and APP 13 require. If we refuse a request we will say why and how to complain.

## 9. Data breaches

We assess any suspected loss or unauthorised access to personal information within 30 days and, where it is likely to result in serious harm, notify the Office of the Australian Information Commissioner and the affected individuals as the Notifiable Data Breaches scheme requires. Customers on our Data Processing Agreement are told within 48 hours of our becoming aware of a breach affecting their data, so they can meet their own obligations.

## 10. Children

Caalano360 is a business tool. We do not knowingly hold information about anyone under 16 as an account holder. Contact records may include minors where a customer's business serves families; that data is held under the customer's instructions.

## 11. Complaints and contact

Privacy Officer: Alex Serrano, Caalano Digital Pty Ltd, alex@caalanodigital.com.au, [postal address]. Security reports: the same address, marked "security".

If you are not satisfied with our response you may complain to the Office of the Australian Information Commissioner at oaic.gov.au or 1300 363 992.

## 12. Changes

We will post changes here with a new version number and effective date, and notify account holders by email of any change that affects how their information is used.
