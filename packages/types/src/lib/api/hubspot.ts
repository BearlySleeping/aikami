import type { UniversalValue } from './oauth2.ts'
/** @see https://legacydocs.hubspot.com/docs/methods/crm-extensions/crm-extensions-overview#data-fetch-request */
export type HubSpotWebhookSearchParams = {
  /** Account id */
  userId: string
  userEmail: string
  associatedObjectId: `${number}`
  associatedObjectType: 'CONTACT' | 'COMPANY' | 'DEAL' // 'TICKET'
  /** This is the same as the hub_id, aka tenantId */
  portalId: string
  email: string
}

export type HubSpotIFrameActionData = {
  type: 'IFRAME'
  width: number
  height: number
  uri: string
  label: string
  associatedObjectProperties?: string[]
}

export type HubSpotConfirmActionData = {
  type: 'CONFIRMATION_ACTION_HOOK'
  confirmationMessage: string
  confirmButtonText: string
  cancelButtonText: string
  httpMethod: 'DELETE' | 'PUT' | 'POST'
  associatedObjectProperties?: string[]
  uri: string
  label: string
}

export type HubSpotActionHookData = {
  type: 'ACTION_HOOK'
  httpMethod: 'DELETE' | 'PUT' | 'POST'
  associatedObjectProperties?: string[]
  uri: string
  label: string
}

export type HubSpotAction =
  | 'IFRAME'
  | 'CONFIRMATION_ACTION_HOOK'
  | 'ACTION_HOOK'

export type HubSpotActionData<T extends HubSpotAction = HubSpotAction> =
  & {
    type: T
  }
  & (T extends 'IFRAME' ? HubSpotIFrameActionData
    : T extends 'CONFIRMATION_ACTION_HOOK' ? HubSpotConfirmActionData
    : T extends 'ACTION_HOOK' ? HubSpotActionHookData
    : never)

export type HubSpotFetchPropertyData = {
  label: string
  dataType: string
  value: string
}

export type HubSpotFetchResultData = {
  objectId: UniversalValue
  title: string
  link: string
  created?: string
  priority?: 'HIGH' | 'MEDIUM' | 'LOW'
  project?: string
  reported_by?: string
  description?: string
  reporter_type?: 'Account Manager' | 'Customer' | 'Partner'
  status?: 'In Progress' | 'Closed' | 'Open'
  ticket_type?: 'Bug' | 'Feature Request' | 'Other'
  updated?: string
  actions?: HubSpotActionData[]
  properties?: HubSpotFetchPropertyData[]
}

export type HubSpotFetchResult = {
  results: HubSpotFetchResultData[]
  settingsAction: HubSpotActionData
  primaryAction: HubSpotActionData
  secondaryActions?: HubSpotActionData[]
  totalCount?: number
}

export type HubSpotPersonData = {
  id: `${number}`
  properties: {
    company: string
    createdate: string
    email: string
    firstname: string
    hs_object_id: `${number}`
    lastmodifieddate: string
    lastname: string
  }
  createdAt: string
  updatedAt: string
  archived: `${boolean}`
}

export type HubSpotSearchRequest = {
  filterGroups?: {
    filters: [
      {
        value: string | number
        highValue?: string
        values?: string[]
        propertyName: string
        operator:
          | 'EQ'
          | 'NEQ'
          | 'LT'
          | 'LTE'
          | 'GT'
          | 'GTE'
          | 'CONTAINS'
          | 'NOT_CONTAINS'
          | 'STARTS_WITH'
          | 'ENDS_WITH'
          | 'HAS_PROPERTY'
          | 'NOT_HAS_PROPERTY'
          | 'HAS_PROPERTY_WITH_VALUE'
          | 'NOT_HAS_PROPERTY_WITH_VALUE'
      },
    ]
  }[]
  sorts?: string[]
  query?: string
  properties: string[]
  limit?: number
  after?: number
}

export type HubSpotProfileMetadata = Record<string, never>

export type HubSpotPersonsResponse = {
  results: HubSpotPersonData[]
  paging: {
    next: {
      after: string
      link: string
    }
  }
}

export type HubSpotCompanyData = {
  id: `${number}`
  properties: {
    createdate: string
    hs_lastmodifieddate: string
    hs_object_id: `${number}`
    name: string
  }
  createdAt: string
  updatedAt: string
  archived: `${boolean}`
}

export type HubSpotCompanyResult = {
  id: string
  properties: HubSpotCompanyData
  createdAt?: string
}

export type HubSpotCompaniesResponse = {
  results: HubSpotCompanyResult[]
  paging: {
    next: {
      after: string
      link: string
    }
  }
}

export type HubSpotTimelineIFrame = {
  linkLabel: string
  headerLabel: string
  url: string
  width: number
  height: number
}

export type HubSpotCreateEventRequest = {
  eventTemplateId: string
  email?: string
  objectId?: UniversalValue
  utk?: string
  domain?: string
  timestamp?: string
  tokens: HubSpotTimelineTokens
  extraData?: Record<string, unknown>
  timelineIFrame: HubSpotTimelineIFrame
}

export type HubSpotTimelineTokens = {
  header: string
  detail: string
  videoTitle: string
  status: 'sent' | 'viewed'
}

export type HubSpotTimelineSentTokens = HubSpotTimelineTokens & {
  status: 'sent'
}

export type HubSpotPercentageWatched = 0 | 25 | 50 | 75 | 100

export type HubSpotTimelineWatchedTokens = HubSpotTimelineTokens & {
  header: string
  ctaClicksAmount?: number
  percentageWatched?: HubSpotPercentageWatched
  timeWatched?: number
  videoTitle: string
  status: 'viewed'
}

export type HubSpotCreateEventResponse = {
  objectType: string
  id: string
  eventTemplateId: string
  email: string
  objectId: UniversalValue
  timestamp: string
  tokens: HubSpotTimelineTokens
  extraData?: Record<string, unknown>
  timelineIFrame: HubSpotTimelineIFrame
}

/**
 * This interface is used to create an engagement (activity) in HubSpot.
 *
 * @see https://legacydocs.hubspot.com/docs/methods/engagements/create_engagement
 */
export type HubspotActivityData = {
  /** The "engagement" field contains the metadata for the engagement. */
  engagement: {
    /** A boolean field to specify whether the engagement is active or not. */
    active: boolean

    /**
     * The "ownerId" field represents the HubSpot user ID of the owner of
     * the engagement.
     */
    ownerId?: UniversalValue

    /**
     * The "type" field denotes the type of the engagement. In this case, it
     * is set to 'NOTE'.
     */
    type: 'NOTE' | 'TASK' | 'EMAIL' | 'MEETING' | 'CALL'

    /**
     * The "timestamp" field holds the time when the engagement happened, in
     * milliseconds since the epoch (1970-01-01T00:00:00Z).
     */
    timestamp: number
  }

  /**
   * The "associations" field is used to associate this engagement with other
   * entities (like contacts or companies) in HubSpot.
   */
  associations: {
    /**
     * The "contactIds" field is an array of contact IDs to associate with
     * this engagement.
     */
    contactIds?: UniversalValue[]

    /**
     * The "companyIds" field is an array of company IDs to associate with
     * this engagement.
     */
    companyIds?: UniversalValue[]

    /**
     * The "dealIds" field is an array of deal IDs to associate with this
     * engagement.
     */
    dealIds?: UniversalValue[]
  }

  /** The "metadata" field contains additional data about the engagement. */
  metadata: {
    /**
     * The "body" field is the main content of the engagement. For a 'NOTE'
     * type engagement, this would be the note text.
     */
    body: string
  }
}

export type HubSpotAccountData = {
  app_id: number
  expires_in: number
  hub_domain: string
  /** This is like the organization ID */
  hub_id: number
  scopes: string[]
  token: string
  token_type: 'access'
  trial_scope_to_scope_group_pks: string[]
  trial_scopes: string[]
  /** The email */
  user: string
  /** This is like the user ID */
  user_id: number
}

/** Represents a Team */
type HubSpotUserTeamData = {
  /** The ID of the team */
  id: string
  /** The name of the team */
  name: string
  /** Whether this team is the primary team for the user */
  primary: boolean
}

/** Represents a user in HubSpot. */
export type HubSpotUserData = {
  /** The ID of the user */
  id: string
  /** The email of the user */
  email: string
  /** The first name of the user */
  firstName: string
  /** The last name of the user */
  lastName: string
  /** The user ID of the user */
  userId: number
  /** The creation date and time of the user */
  createdAt: string
  /** The update date and time of the user */
  updatedAt: string
  /** Whether the user is archived */
  archived: boolean
  /** The teams that the user is a member of */
  teams: HubSpotUserTeamData[]
}
