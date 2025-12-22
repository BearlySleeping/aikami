import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services'
import { npcService } from '$services'
import type { NpcData } from '@aikami/types'

export type ChatViewModelOptions = BaseViewModelOptions & {
  npcId: string
}

export type ChatViewModelInterface = BaseViewModelInterface & {
  readonly npc: NpcData | null
  readonly isLoading: boolean
  readonly isSending: boolean
  message: string
  sendMessage(): void
}

class ChatViewModel extends BaseViewModel<ChatViewModelOptions> implements ChatViewModelInterface {
  npc = $state<NpcData | null>(null)
  isLoading = $state(false)
  isSending = $state(false)
  message = $state('')

  override async initialize(): Promise<void> {
    this.isLoading = true
    try {
      const npcData = await npcService.get(this._options.npcId)
      this.npc = npcData ?? null
    } catch (error) {
      this.error('initialize', error)
    } finally {
      this.isLoading = false
    }
    await super.initialize()
  }

  sendMessage(): void {
    if (!this.message || !this.npc) return

    this.isSending = true
    try {
      // TODO: Implement message sending logic
      console.log(`Sending message to ${this.npc.name}: ${this.message}`)
      this.message = ''
    } catch (error) {
      this.error('sendMessage', error)
    } finally {
      this.isSending = false
    }
  }
}

export const getChatViewModel = (options: ChatViewModelOptions): ChatViewModelInterface =>
  new ChatViewModel(options)
