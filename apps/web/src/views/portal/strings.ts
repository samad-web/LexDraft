/**
 * All user-facing strings for the client portal sub-app live here.
 *
 * v1 ships English-only (CLIENT_PORTAL.md §6.6) but the spec calls for every
 * string to live in a single locale module so v2's translation pass is a
 * data swap, not a refactor. New components should import from here rather
 * than inlining literals.
 */

export const portalStrings = {
  // shared
  appName: 'Client Portal',
  signOut: 'Sign out',
  back: '← Back',
  loading: 'Loading…',
  empty: '-',

  // navigation
  navDashboard: 'Dashboard',
  navMessages: 'Messages',
  navProfile: 'Profile',

  // dashboard
  dashboardError: 'Could not load your dashboard.',
  countActiveMatters: 'Active matters',
  countUpcomingHearings: 'Upcoming hearings',
  countDocumentsToSign: 'Documents to sign',
  countOpenInvoices: 'Open invoices',
  countUnreadMessages: 'Unread messages',
  yourMatters: 'Your matters',
  upcomingHearings: 'Upcoming hearings',
  recentDocuments: 'Recent documents',
  invoices: 'Invoices',
  noActiveMatters: 'No active matters yet.',
  noHearings: 'No upcoming hearings on file.',
  noDocuments: 'No documents shared with you.',
  noInvoices: 'No invoices yet.',
  matterOpen: 'Open',

  // matter detail
  matterNotFound: 'Could not load this matter.',
  matterHearings: 'Hearings',
  matterDocuments: 'Documents',
  matterMessages: 'Messages on this matter',
  noMatterHearings: 'No hearings on file for this matter.',
  noMatterDocuments: 'No documents shared on this matter.',

  // documents
  download: 'Download',
  acknowledge: 'Acknowledge',
  acknowledging: 'Signing…',
  pillActionNeeded: 'Action needed',
  pillAcknowledged: 'Acknowledged',
  errDownload: 'Could not get the download link.',
  errAcknowledge: 'Could not acknowledge the document.',

  // messages
  messagesGeneralTitle: 'General thread',
  messagesGeneralIntro:
    'Use this thread for conversations not tied to a specific matter. For matter-specific questions, open the matter and use its thread.',
  messagesPlaceholder: 'Type your message…',
  messagesSend: 'Send',
  messagesSending: 'Sending…',
  messagesEmpty: 'No messages yet - start the conversation.',
  messagesLoading: 'Loading messages…',
  messagesError: 'Could not load messages.',
  messagesSendError: 'Could not send the message.',
  messagesYou: 'You',

  // profile
  profileTitle: 'Profile',
  profileError: 'Could not load your profile.',
  profileSaved: 'Saved.',
  profileNameLabel: 'Name',
  profileEmailLabel: 'Contact email',
  profileNameLocked: 'Your advocate manages this - ask them to update it.',
  profileEmailLocked: 'Your sign-in email - ask your advocate to change it.',
  profileLanguageLabel: 'Language',
  profileLanguageEnglish: 'English',
  profileNotificationsTitle: 'Notifications',
  profileNotificationsHint:
    'Choose which transactional emails you want to receive. Security notices (sign-in alerts, link resends) ignore these preferences.',
  profileNotifNewDocument: 'New document shared with me',
  profileNotifHearingReminder: 'Hearing reminders',
  profileNotifNewMessage: 'New message from my advocate',
  profileNotifInvoiceIssued: 'Invoice issued',
  profileNotifInvoiceOverdue: 'Invoice overdue',
  profileSave: 'Save changes',
  profileSaving: 'Saving…',
  profileForgetTitle: 'Right to be forgotten',
  profileForgetBody:
    'Submit a request to have your personal data deleted. Your advocate is required to respond under the DPDP Act, but data tied to active litigation may be retained on legal-hold grounds.',
  profileForgetButton: 'Request data deletion',
  profileForgetSubmitting: 'Submitting…',
  profileForgetSubmitted:
    'Your request has been recorded. Your advocate will be in touch.',
  profileForgetReasonLabel: 'Reason (optional)',
  profileForgetConfirm:
    'Are you sure you want to request deletion of your personal data? This is sent to your advocate to action.',
} as const;

export type PortalStrings = typeof portalStrings;
