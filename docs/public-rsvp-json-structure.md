# Public RSVP form and JSON API

Admins configure the public RSVP form from **Planning space → Settings → RSVP form**. Settings are saved per planning space and apply to both the guest-facing web page and the POST API. The public form always asks for the guest name and a Yes/No RSVP. Admins can also:

- change the form heading, welcome text, and Yes/No labels;
- turn the number-of-people question on or off;
- turn check-in and check-out date questions on or off;
- add any number of date choices (up to 20 for each enabled date question).
- add up to 10 extra questions: short answer, yes/no, or choose-one.

An enabled date question needs at least one date choice. Date answers are required only for a Yes RSVP. No replies are recorded without stay dates. When the number-of-people question is off, the guest record uses a count of 1.

## Links

The RSVP endpoint stays the same for a given Supabase project and Edge Function:

```text
https://ibrtphygcvswnarauyrs.supabase.co/functions/v1/public-rsvp
```

It changes if the Supabase project reference or function name changes. Staging projects have a different endpoint.

The guest-facing link is created in the same Settings module, for example:

```text
https://knot-list.vercel.app/#rsvp/YOUR_64_CHARACTER_RSVP_TOKEN
```

There is one active link/token per planning space. Both the web link and API use that token. Rotating or turning off the link invalidates the old token.

## Request requirements

All requests use `POST` with a JSON body and these headers:

```http
Content-Type: application/json
apikey: YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Use the public publishable/anon key from Supabase Project Settings → API Keys. Never put a service-role key in a browser, mobile app, or third-party client. The RSVP token identifies the planning space. The server checks submitted date/count fields against that space’s current saved form settings.

## Load the form

```json
{
  "action": "load",
  "token": "YOUR_64_CHARACTER_RSVP_TOKEN"
}
```

Successful response:

```json
{
  "workspaceName": "Oshi's Wedding",
  "settings": {
    "title": "You’re invited",
    "intro": "We’d love to know if you can join us.",
    "askGuestCount": true,
    "askCheckinDate": true,
    "checkinOptions": [
      { "date": "2027-02-19", "label": "19 Feb 2027" },
      { "date": "2027-02-20", "label": "20 Feb 2027" }
    ],
    "askCheckoutDate": false,
    "checkoutOptions": [],
    "yesLabel": "Yes, we’ll be there",
    "noLabel": "No, we can’t make it",
    "customQuestions": [
      {
        "id": "8b7e8dbb-cbbb-4e33-bff8-f88c04446d91",
        "label": "Dietary requirements",
        "type": "select",
        "required": false,
        "options": ["Vegetarian", "Vegan", "No preference"]
      }
    ]
  }
}
```

The actual form configuration is whatever the workspace admin saved in Settings; the example above shows the initial defaults. Custom questions include a stable ID, label, type, required flag, and (for choose-one questions) options.

## Submit a response

Include only the fields enabled by that workspace’s form settings. The example below shows all optional questions enabled:

```json
{
  "action": "submit",
  "token": "YOUR_64_CHARACTER_RSVP_TOKEN",
  "name": "Avery Patel",
  "guestCount": 2,
  "rsvp": "confirmed",
  "checkinDate": "2027-02-19",
  "checkoutDate": "2027-02-22",
  "customAnswers": {
    "YOUR_QUESTION_ID": "Vegetarian"
  }
}
```

Field rules:

- `name`: required string, 1–140 characters.
- `rsvp`: `confirmed` for Yes or `declined` for No.
- `guestCount`: whole number from 1 to 500 when the question is enabled; omit it when disabled.
- `checkinDate`: `YYYY-MM-DD`, required for a confirmed response when check-in is enabled; it must match one of the saved choices.
- `checkoutDate`: `YYYY-MM-DD`, required for a confirmed response when check-out is enabled; it must match one of the saved choices.
- `customAnswers`: optional object keyed by the question IDs returned from `load`. Values must match the configured type and options. Required custom questions must have an answer. Text answers allow up to 100 words and 2,000 characters.
- Do not include date fields for a declined response.

Successful response:

```json
{
  "success": true,
  "workspaceName": "Oshi's Wedding"
}
```

The response creates a guest entry, marks it **Self RSVP**, stores the extra answers together in the guest’s `public_rsvp_custom_answers` JSONB field, and creates an in-app notification for workspace admins. Admins can see answers in guest details and exports. Changing the custom questions later does not rewrite answers guests already submitted. Browser push is attempted for admins who enabled it and have a valid subscription.

## cURL example

```bash
curl --request POST \
  'https://ibrtphygcvswnarauyrs.supabase.co/functions/v1/public-rsvp' \
  --header 'Content-Type: application/json' \
  --header 'apikey: YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY' \
  --data '{
    "action": "submit",
    "token": "YOUR_64_CHARACTER_RSVP_TOKEN",
    "name": "Avery Patel",
    "guestCount": 2,
    "rsvp": "confirmed",
    "checkinDate": "2027-02-19",
    "checkoutDate": "2027-02-22"
  }'
```

## Errors

Errors are JSON objects, for example:

```json
{
  "error": "This RSVP link is invalid or has been turned off."
}
```

Anyone with the active RSVP link/token can submit a response to its planning space. Keep the link private to the intended invitees.
