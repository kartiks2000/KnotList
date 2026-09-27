export type PublicRsvpDateOption = {
  date: string
  label: string
}

export type PublicRsvpCustomQuestion = {
  id: string
  label: string
  type: 'text' | 'yes_no' | 'select'
  required: boolean
  options: string[]
}

export type PublicRsvpSettings = {
  title: string
  intro: string
  askGuestCount: boolean
  askCheckinDate: boolean
  checkinOptions: PublicRsvpDateOption[]
  askCheckoutDate: boolean
  checkoutOptions: PublicRsvpDateOption[]
  yesLabel: string
  noLabel: string
  customQuestions: PublicRsvpCustomQuestion[]
}

export const DEFAULT_PUBLIC_RSVP_SETTINGS: PublicRsvpSettings = {
  title: 'You’re invited',
  intro: 'We’d love to know if you can join us.',
  askGuestCount: true,
  askCheckinDate: true,
  checkinOptions: [
    { date: '2027-02-19', label: '19 Feb 2027' },
    { date: '2027-02-20', label: '20 Feb 2027' },
  ],
  askCheckoutDate: false,
  checkoutOptions: [],
  yesLabel: 'Yes, we’ll be there',
  noLabel: 'No, we can’t make it',
  customQuestions: [],
}

export function dateOptionLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day))
}

export function normalizePublicRsvpSettings(value: unknown): PublicRsvpSettings {
  if (!value || typeof value !== 'object') return DEFAULT_PUBLIC_RSVP_SETTINGS
  const candidate = value as Partial<PublicRsvpSettings>
  const options = (input: unknown) => Array.isArray(input)
    ? input.filter((option): option is PublicRsvpDateOption => Boolean(option && typeof option === 'object' && typeof (option as PublicRsvpDateOption).date === 'string'))
      .map(option => ({ date: option.date, label: option.label || dateOptionLabel(option.date) }))
    : []
  return {
    title: typeof candidate.title === 'string' ? candidate.title : DEFAULT_PUBLIC_RSVP_SETTINGS.title,
    intro: typeof candidate.intro === 'string' ? candidate.intro : DEFAULT_PUBLIC_RSVP_SETTINGS.intro,
    askGuestCount: candidate.askGuestCount !== false,
    askCheckinDate: candidate.askCheckinDate === true,
    checkinOptions: options(candidate.checkinOptions),
    askCheckoutDate: candidate.askCheckoutDate === true,
    checkoutOptions: options(candidate.checkoutOptions),
    yesLabel: typeof candidate.yesLabel === 'string' ? candidate.yesLabel : DEFAULT_PUBLIC_RSVP_SETTINGS.yesLabel,
    noLabel: typeof candidate.noLabel === 'string' ? candidate.noLabel : DEFAULT_PUBLIC_RSVP_SETTINGS.noLabel,
    customQuestions: Array.isArray(candidate.customQuestions)
      ? candidate.customQuestions.filter((question): question is PublicRsvpCustomQuestion => Boolean(
        question && typeof question.id === 'string' && typeof question.label === 'string'
        && ['text', 'yes_no', 'select'].includes(question.type),
      )).map(question => ({
        id: question.id,
        label: question.label,
        type: question.type,
        required: question.required === true,
        options: Array.isArray(question.options) ? question.options.filter(option => typeof option === 'string') : [],
      }))
      : [],
  }
}
