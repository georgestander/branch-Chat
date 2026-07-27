import {
  DESKTOP_EVENT_CHANNELS,
  IPC_CHANNELS,
  type BranchyDesktopApi,
  type DesktopCommandRequestMap,
  type DesktopCommandResponseMap,
} from "./shared/contracts.ts";
import {
  validateConversationTitleUpdate,
  validateStreamPortMessage,
} from "./shared/validators.ts";

export interface RendererIpcBridge {
  invoke(channel: string, payload: unknown): Promise<unknown>;
  postMessage(
    channel: string,
    payload: unknown,
    transfer?: readonly MessagePort[],
  ): void;
  on(channel: string, listener: (payload: unknown) => void): () => void;
  send(channel: string, payload: unknown): void;
}

export interface RendererMessageChannel {
  port1: MessagePort;
  port2: MessagePort;
}

export interface CreateBranchyDesktopApiOptions {
  createMessageChannel?: () => RendererMessageChannel;
  createSubscriptionId?: () => string;
}

function defaultMessageChannel(): RendererMessageChannel {
  return new MessageChannel();
}

function defaultSubscriptionId(): string {
  return crypto.randomUUID();
}

export function createBranchyDesktopApi(
  bridge: RendererIpcBridge,
  options: CreateBranchyDesktopApiOptions = {},
): BranchyDesktopApi {
  const createMessageChannel =
    options.createMessageChannel ?? defaultMessageChannel;
  const createSubscriptionId =
    options.createSubscriptionId ?? defaultSubscriptionId;

  const invoke = async <
    Channel extends Exclude<
      keyof DesktopCommandRequestMap,
      typeof IPC_CHANNELS.streamOpen | typeof IPC_CHANNELS.streamClose
    >,
  >(
    channel: Channel,
    payload: DesktopCommandRequestMap[Channel],
  ): Promise<DesktopCommandResponseMap[Channel]> =>
    (await bridge.invoke(channel, payload)) as DesktopCommandResponseMap[Channel];

  return {
    bootstrap: (input = {}) => invoke(IPC_CHANNELS.bootstrap, input),
    listConversations: (input = {}) =>
      invoke(IPC_CHANNELS.listConversations, input),
    createConversation: (input = {}) =>
      invoke(IPC_CHANNELS.createConversation, input),
    loadConversation: (input) =>
      invoke(IPC_CHANNELS.loadConversation, input),
    renameConversation: (input) =>
      invoke(IPC_CHANNELS.renameConversation, input),
    deleteConversation: (input) =>
      invoke(IPC_CHANNELS.deleteConversation, input),
    archiveConversation: (input) =>
      invoke(IPC_CHANNELS.archiveConversation, input),
    unarchiveConversation: (input) =>
      invoke(IPC_CHANNELS.unarchiveConversation, input),
    updateConversationSettings: (input) =>
      invoke(IPC_CHANNELS.updateConversationSettings, input),
    updateConversationCanvas: (input) =>
      invoke(IPC_CHANNELS.updateConversationCanvas, input),
    openCanvasBranchCard: (input) =>
      invoke(IPC_CHANNELS.openCanvasBranchCard, input),
    loadCanvasBranchCard: (input) =>
      invoke(IPC_CHANNELS.loadCanvasBranchCard, input),
    renameBranch: (input) => invoke(IPC_CHANNELS.renameBranch, input),
    deleteBranch: (input) => invoke(IPC_CHANNELS.deleteBranch, input),
    saveBranchNote: (input) =>
      invoke(IPC_CHANNELS.saveBranchNote, input),
    updateBranchNote: (input) =>
      invoke(IPC_CHANNELS.updateBranchNote, input),
    saveComposerDraft: (input) =>
      invoke(IPC_CHANNELS.saveComposerDraft, input),
    sendMessage: (input) => invoke(IPC_CHANNELS.sendMessage, input),
    cancelMessage: (input) => invoke(IPC_CHANNELS.cancelMessage, input),
    getAttachmentConstraints: () =>
      invoke(IPC_CHANNELS.getAttachmentConstraints, {}),
    createAttachment: (input) =>
      invoke(IPC_CHANNELS.createAttachment, input),
    removeAttachment: (input) =>
      invoke(IPC_CHANNELS.removeAttachment, input),
    requestMicrophonePermission: () =>
      invoke(IPC_CHANNELS.requestMicrophonePermission, {}),
    transcribeAudio: (input) =>
      invoke(IPC_CHANNELS.transcribeAudio, input),
    getGeneratedImageUrl: (input) =>
      invoke(IPC_CHANNELS.getGeneratedImageUrl, input),
    saveGeneratedImage: (input) =>
      invoke(IPC_CHANNELS.saveGeneratedImage, input),
    retryGeneratedImage: (input) =>
      invoke(IPC_CHANNELS.retryGeneratedImage, input),
    getAccountState: () => invoke(IPC_CHANNELS.getAccountState, {}),
    startChatGptLogin: () =>
      invoke(IPC_CHANNELS.startChatGptLogin, {}),
    cancelChatGptLogin: (input) =>
      invoke(IPC_CHANNELS.cancelChatGptLogin, input),
    logoutChatGpt: () => invoke(IPC_CHANNELS.logoutChatGpt, {}),
    exportArchive: (input = {}) => invoke(IPC_CHANNELS.exportArchive, input),
    importArchive: (input) => invoke(IPC_CHANNELS.importArchive, input),
    openExternal: (input) => invoke(IPC_CHANNELS.openExternal, input),
    subscribeConversationTitles: (listener) =>
      bridge.on(DESKTOP_EVENT_CHANNELS.conversationTitleUpdated, (payload) => {
        try {
          listener(validateConversationTitleUpdate(payload));
        } catch {
          // Invalid main-process data is ignored at the trust boundary.
        }
      }),
    subscribeStream: (streamId, listener) => {
      const subscriptionId = createSubscriptionId();
      const channel = createMessageChannel();
      let closed = false;

      channel.port1.onmessage = (event) => {
        if (closed) {
          return;
        }
        try {
          const message = validateStreamPortMessage(event.data);
          if (
            message.streamId !== streamId ||
            (message.kind === "opened" &&
              message.subscriptionId !== subscriptionId)
          ) {
            return;
          }
          if (message.kind === "event") {
            listener(message.event);
          }
        } catch {
          // Invalid main-process data is ignored at the trust boundary.
        }
      };
      channel.port1.start();
      bridge.postMessage(
        IPC_CHANNELS.streamOpen,
        { streamId, subscriptionId },
        [channel.port2],
      );

      return () => {
        if (closed) {
          return;
        }
        closed = true;
        channel.port1.close();
        bridge.send(IPC_CHANNELS.streamClose, {
          streamId,
          subscriptionId,
        });
      };
    },
  };
}
