// Shared, offline-readable policy copy. Keep website/privacy.html in step when
// this text changes; the website is published separately from app releases.
export const PRIVACY_POLICY_TITLE = 'On Paper privacy policy';
export const PRIVACY_POLICY_DATE = '2026-09-22';
export const PRIVACY_POLICY_URL = 'https://onpaper.pro/privacy.html';
export const PRIVACY_SUPPORT_URL = 'https://github.com/ashproto/Resume-Designer/issues';

export const PRIVACY_POLICY_SECTIONS = [
  {
    title: 'About this policy',
    paragraphs: [
      'On Paper is developed by Ash Shah. This policy covers the On Paper app and its project website. You do not need an On Paper account to use the app. The developer does not operate a server that receives your career documents. Some features connect to the outside services described below.',
    ],
  },
  {
    title: 'Your information on your device',
    paragraphs: [
      'The app stores the information you enter or import: resumes, contact details, career profiles, job descriptions, application records, reusable answers, chats, document history, settings, and AI usage records. Native apps save app data on your device; the browser version uses browser storage. This information supports editing, restoring earlier work, and the other features you use.',
      'Document storage and exported backups are not encrypted by On Paper itself. Your operating system, device security, and backup settings determine their additional protection. The app does not include advertising or an analytics service that reports your activity to the developer.',
    ],
  },
  {
    title: 'iCloud sync',
    paragraphs: [
      'On iPhone, iPad, and Mac, the app syncs workspace information through Apple CloudKit in your own iCloud account when iCloud is available. This includes resumes, profiles, jobs, applications, chats, history, settings, and usage records. Sync can run automatically and in the background. The developer does not receive these documents through an On Paper server.',
      'Apple provides iCloud under its own terms and privacy policy. You can manage On Paper’s iCloud data through your Apple account’s iCloud storage settings. Removing cloud data does not erase local copies or files you exported. When the app detects that its iCloud data was removed, it pauses syncing; choosing Resume syncing can upload the local copies again.',
    ],
  },
  {
    title: 'Optional AI assistance',
    paragraphs: [
      'AI assistance uses your OpenRouter API key. Before the first AI request on a device, the app asks for permission to share information with OpenRouter and the model providers it routes to. Depending on the feature, a request can include your message and conversation, resume, career profile and contact details, job descriptions, interview answers, or text extracted from an imported file. These services use that information to produce the result you requested.',
      'OpenRouter forwards requests to a model provider. Automatic fallback can send the request to a different model or provider when the selected one is unavailable. Enabling web search also allows OpenRouter’s search service to process search queries derived from the request. Outside services receive connection and request information, such as your IP address, as part of these requests.',
      'OpenRouter and model providers have their own retention, training, security, and deletion policies. Those practices can vary by provider and by your OpenRouter account settings. On Paper does not promise that every request has zero retention or is excluded from model training. Review OpenRouter’s policy at https://openrouter.ai/privacy and provider details at https://openrouter.ai/providers before sharing sensitive information.',
      'You can withdraw permission for future AI requests in Settings. Removing your OpenRouter key also prevents new AI requests from this installation. These choices do not recall information already sent or erase a provider’s copies. Editing and exporting your documents remain available without AI.',
    ],
  },
  {
    title: 'Your API key',
    paragraphs: [
      'Native apps store the OpenRouter key in the operating system’s credential store and send it to OpenRouter to authorize requests. On Apple devices, the key can sync through iCloud Keychain between devices using the same app access group. The iPhone and iPad app share a group; the Mac app uses a separate one. The key is not part of the app’s CloudKit document records or newly exported JSON backups.',
      'The browser version encrypts the key in browser storage. A full copy of the browser profile can contain both the encrypted key and the means to unlock it. Remove the key in Settings when you no longer want the app to use it, and revoke it with OpenRouter if you need to invalidate it. Removing the app alone does not reliably remove a keychain item or revoke the key.',
    ],
  },
  {
    title: 'Fonts, model lists, and updates',
    paragraphs: [
      'Google-hosted document fonts load from Google when a saved or selected style uses them, including the default font pairing. Google receives the requested font and normal connection information, such as your IP address and browser information. The app does not send your resume text in a font request. Choosing system fonts avoids new Google font downloads for that style. The app’s own interface fonts are bundled.',
      'The app can fetch the model catalog from OpenRouter without sending your documents or API key. Desktop update checks and release notes use GitHub. These requests send normal connection information to the service providing the response. The iOS app receives updates through Apple rather than the desktop updater.',
    ],
  },
  {
    title: 'Export, retention, and deletion',
    paragraphs: [
      'Use Export backup in Settings to save a JSON copy of your app data. Exported files are under your control and may contain personal information and chat history. Newly created backups exclude your OpenRouter key, but older backups may contain it. Files you share through another app or service become subject to that recipient’s handling of them.',
      'App data remains on your devices and, where synced, in your iCloud account until you remove it. You can edit or delete documents, chats, and profiles in the app. Deleting an item from a list is not a guarantee that every copy is erased: document history and deletion records can remain, and deleting a profile leaves its underlying CloudKit records in iCloud. Backups and previously shared files remain separate copies.',
      'For a fuller removal, remove On Paper’s data from iCloud storage, remove its local app or browser data on each device, and delete any exported files and backups you no longer want. Remove or revoke the API key separately. Other devices, system backups, and outside services may retain copies under their own settings and policies. The developer cannot erase information held in your personal iCloud account or by an AI provider on your behalf.',
    ],
  },
  {
    title: 'Website and support',
    paragraphs: [
      'The project website is hosted by GitHub Pages. Its main page uses Google Fonts and saves your theme preference in your browser. This privacy page uses system fonts. The hosting and font services receive ordinary website request information; the website does not upload your app documents or include an analytics script.',
      'For questions about this policy or a privacy concern, contact the project through https://github.com/ashproto/Resume-Designer/issues. GitHub issues and discussions are public: do not post API keys, resumes, or other private information. Information you choose to post is visible to the project maintainer and others and is handled under GitHub’s terms and privacy policy. If your request needs private details, ask for a private contact route without posting those details.',
    ],
  },
  {
    title: 'Changes to this policy',
    paragraphs: [
      'The date above identifies this policy version. Updated app releases and the project website may carry a newer version when the app’s data practices change. The policy remains available inside the app so you can read it without a network connection.',
    ],
  },
];
