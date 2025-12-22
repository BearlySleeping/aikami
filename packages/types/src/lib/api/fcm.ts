export type FCMTopicNotificationData = {
  topic: string
  title: string
  body: string
  image?: string
}

export type FCMText = {
  title: string
  body: string
}
export type FCMPlatform = 'android' | 'ios' | 'web'
