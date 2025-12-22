import logger from '$logger'

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!navigator.clipboard) {
      return fallbackCopyTextToClipboard(text)
    }

    await navigator.clipboard.writeText(text)
    return true
  } catch (_error) {
    return fallbackCopyTextToClipboard(text)
  }
}

const fallbackCopyTextToClipboard = (text: string): boolean => {
  const textArea = document.createElement('textarea')
  textArea.value = text

  // Avoid scrolling to bottom
  textArea.style.top = '0'
  textArea.style.left = '0'
  textArea.style.position = 'fixed'

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  let successful = false
  try {
    successful = document.execCommand('copy')
  } catch (err) {
    logger.error('Fallback: Oops, unable to copy', err)
  }

  document.body.removeChild(textArea)
  return successful
}
