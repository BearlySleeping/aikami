export type AuthCreateRequest = {
  /**
   * Set the uid of the user to create.
   *
   * NB: Only use this for white label users.
   */
  uid?: string
  email?: string
  displayName?: string
  password?: string
  phoneNumber?: string
}
export type AuthUpdateRequest = {
  email?: string
  displayName?: string
  password?: string
  phoneNumber?: string
}
