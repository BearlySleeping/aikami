import 'dayjs/locale/da.js'
import 'dayjs/locale/nb.js'
import dayjs from 'dayjs'
import calendar from 'dayjs/plugin/calendar.js'
import relativeTime from 'dayjs/plugin/relativeTime.js'

export const formatDate = (
  date: Date | string | number,
  locale: string,
  format?: string,
): string => {
  checkAndUpdateLocale(locale)
  return dayjs(date).format(format)
}

export const toCalendar = (date: Date | number, locale: string): string => {
  checkAndUpdateLocale(locale)
  dayjs.extend(calendar)
  return dayjs(date).calendar(null, { sameElse: 'DD/MM/YYYY' })
}

export const getFromNow = (date: Date, locale: string): string => {
  checkAndUpdateLocale(locale)
  dayjs.extend(relativeTime)
  return dayjs(date).fromNow(true) // adding true removes "ago" prefix
}

export const getAllMonthsLite = (locale: string): string[] => {
  const labels: string[] = []
  checkAndUpdateLocale(locale)

  for (let monthIndex = 1; monthIndex <= 12; monthIndex++) {
    labels.push(dayjs(new Date(2000, monthIndex, 0)).format('MMM'))
  }
  return labels
}

export const getFullTextMonth = (date: Date, locale: string): string => {
  checkAndUpdateLocale(locale)

  return dayjs(date).format('MMMM')
}

let cachedDayJsLocale = 'en'
const checkAndUpdateLocale = (locale: string) => {
  const dayjsLocale = convertToDayJsLocale(locale)
  if (dayjsLocale !== cachedDayJsLocale) {
    cachedDayJsLocale = dayjsLocale
    dayjs.locale(dayjsLocale)
  }
}

const convertToDayJsLocale = (locale: string) => {
  switch (locale) {
    case 'no':
    case 'nb':
    case 'nn':
      return 'nb'
    case 'da':
      return 'da'
    default:
      return 'en'
  }
}
