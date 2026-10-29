# SOS alerts on WhatsApp

SafeNav can send every SOS to trusted contacts on WhatsApp automatically, with
nothing to tap on the phone in danger. It uses Meta's official
[WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).

## Why it needs the WhatsApp Business Platform

WhatsApp offers no way for an app to send messages from a person's own
WhatsApp account. A pre-filled `wa.me` link (which SafeNav also shows) still
needs someone to press Send. The only permitted way to send automatically is
from a **business number** on the WhatsApp Business Platform, which means:

- the message comes from SafeNav's business number, not from the user's own WhatsApp;
- messages that start a conversation must use a **template Meta has approved**;
- recipients must **opt in**: each contact does this once from their invite link;
- Meta **charges per message**. A utility message to an Indian number costs
  about ₹0.12 (check Meta's current [rate card](https://developers.facebook.com/docs/whatsapp/pricing)).

Tools that automate a personal WhatsApp account (WhatsApp Web scripts,
unofficial libraries, accessibility auto-clickers) break WhatsApp's terms and
get numbers banned, often without warning: the worst way for an SOS to fail.
SafeNav doesn't use them.

## Setup (about 30 minutes, plus template review)

1. **Meta app.** At [developers.facebook.com](https://developers.facebook.com/apps) create an app of type *Business* and add the **WhatsApp** product.
2. **Phone number.** In WhatsApp → API Setup, add a phone number for SafeNav. It must not already be registered on the WhatsApp or WhatsApp Business app. (Meta's free test number works for trying it out, but only sends to up to 5 numbers you verify there.)
3. **Permanent token.** In Meta Business Settings → System users, create a system user, give it the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. The temporary token on the API Setup page expires after 24 hours.
4. **Template.** In WhatsApp Manager → Message templates, create:
   - Name: `safenav_alert`
   - Category: **Utility**
   - Language: English (`en`)
   - Body:

     ```
     SafeNav alert for you as a trusted contact:

     {{1}}

     {{2}}

     Open to see where they are: {{3}}

     If you can't reach them and think they're in danger, call 112.
     ```

   - Sample values: `🚨 SOS: Asha Verma needs help` / `Asha pressed SOS. Tap to see their live location, then call them.` / `https://safenav-0ywr.onrender.com/t/abc123`

   Wait for approval (usually minutes, sometimes a day). The same template carries SOS, "is safe now", journey and test alerts.
5. **Settings on Render** (Environment):

   | Variable | Value |
   | --- | --- |
   | `WHATSAPP_TOKEN` | the permanent token |
   | `WHATSAPP_PHONE_NUMBER_ID` | *Phone number ID* from API Setup (not the phone number) |
   | `WHATSAPP_TEMPLATE` | `safenav_alert` (or your template's name) |
   | `WHATSAPP_TEMPLATE_LANG` | `en` |

6. **Optional: replies.** To let contacts reply STOP, set the webhook in WhatsApp → Configuration to `https://<your-domain>/api/whatsapp/webhook`, choose a verify token, subscribe to `messages`, and add `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` (App settings → Basic → App secret) on Render. Webhook calls are rejected unless they carry Meta's signature.

`/api/health` shows "SOS alerts on WhatsApp: configured" once the token and phone number ID are set.

## How a contact turns it on

They open the invite link you sent them and tap **Turn on WhatsApp alerts**.
That is their opt-in, recorded for the number you saved for them. From then on
every SOS sends them a WhatsApp message with your live location, and the SOS
screen shows "Reached by WhatsApp". A map pin is added too when they have
messaged the business number in the last 24 hours (WhatsApp only allows
non-template messages inside that window).
