const { contextBridge } = require("electron");

const CREATED_AT = "2026-07-23T08:00:00.000Z";
const CONVERSATION_ID = "branch-switch-performance";
const ROOT_BRANCH_ID = "root";
const CHILD_BRANCH_ID = "child";

function createMessages(branchId, count, offset) {
  return Array.from({ length: count }, (_, index) => {
    const id = `${branchId}-message-${String(index).padStart(3, "0")}`;
    const content = `Representative message ${offset + index}: ${"x".repeat(80)}`;
    return {
      id,
      branchId,
      role: index % 2 === 0 ? "user" : "assistant",
      content,
      createdAt: new Date(
        Date.parse(CREATED_AT) + (offset + index) * 1_000,
      ).toISOString(),
      tokenUsage: null,
      renderedHtml: `<p>${content}</p>`,
      hasBranchHighlight: false,
      branchAnchors: [],
    };
  });
}

const rootMessages = createMessages(ROOT_BRANCH_ID, 1, 0);
const childMessages = createMessages(CHILD_BRANCH_ID, 499, 1);
const allMessages = [...rootMessages, ...childMessages];
const messageRecord = Object.fromEntries(
  allMessages.map((message) => [message.id, message]),
);
const rootMessageIds = rootMessages.map((message) => message.id);
const childMessageIds = childMessages.map((message) => message.id);

const snapshot = {
  conversation: {
    id: CONVERSATION_ID,
    ownerId: "local-performance-fixture",
    rootBranchId: ROOT_BRANCH_ID,
    createdAt: CREATED_AT,
    settings: {
      model: "gpt-5.6-terra",
      temperature: 0,
      reasoningEffort: "medium",
      composerDefaults: { preset: "fast", tools: [] },
    },
  },
  branches: {
    [ROOT_BRANCH_ID]: {
      id: ROOT_BRANCH_ID,
      parentId: null,
      title: "Root benchmark",
      createdFrom: {
        messageId: rootMessageIds[0],
        excerpt: null,
        span: null,
      },
      messageIds: rootMessageIds,
      createdAt: CREATED_AT,
      archivedAt: null,
    },
    [CHILD_BRANCH_ID]: {
      id: CHILD_BRANCH_ID,
      parentId: ROOT_BRANCH_ID,
      title: "Child benchmark",
      createdFrom: {
        messageId: rootMessageIds[0],
        excerpt: "Representative branch source",
        span: { start: 0, end: 28 },
      },
      messageIds: childMessageIds,
      createdAt: "2026-07-23T08:05:00.000Z",
      archivedAt: null,
    },
  },
  messages: messageRecord,
  canvas: {
    version: 2,
    viewport: { x: 40, y: 100, zoom: 0.92 },
    focusedBranchId: ROOT_BRANCH_ID,
    nodes: {
      [ROOT_BRANCH_ID]: {
        branchId: ROOT_BRANCH_ID,
        x: 20,
        y: 20,
        width: 680,
        height: 700,
        folded: false,
        expanded: true,
      },
      [CHILD_BRANCH_ID]: {
        branchId: CHILD_BRANCH_ID,
        x: 760,
        y: 20,
        width: 680,
        height: 700,
        folded: false,
        expanded: false,
      },
    },
  },
};

const directoryEntry = {
  id: CONVERSATION_ID,
  title: "Branch switch performance",
  createdAt: CREATED_AT,
  lastActiveAt: CREATED_AT,
  branchCount: 2,
  archivedAt: null,
};
const loadResult = {
  conversationId: CONVERSATION_ID,
  snapshot,
  version: 1,
  draftsByBranch: {},
  activeStreams: [],
};
const bootstrap = {
  kind: "ready",
  ...loadResult,
  conversation: snapshot.conversation,
  initialActiveBranchId: ROOT_BRANCH_ID,
  initialMessagesByBranch: {
    [ROOT_BRANCH_ID]: rootMessages,
    [CHILD_BRANCH_ID]: childMessages,
  },
  conversations: { active: [directoryEntry], archived: [] },
  account: {
    status: "connected",
    account: { email: null, planType: "performance-fixture" },
  },
};

const unsupported = async () => {
  throw new Error("Unsupported in the branch-switch performance harness");
};

contextBridge.exposeInMainWorld("branchy", {
  bootstrap: async () => bootstrap,
  listConversations: async () => bootstrap.conversations,
  createConversation: unsupported,
  loadConversation: async () => loadResult,
  renameConversation: unsupported,
  deleteConversation: unsupported,
  archiveConversation: unsupported,
  unarchiveConversation: unsupported,
  updateConversationSettings: async () => loadResult,
  updateConversationCanvas: async () => loadResult,
  openCanvasBranchCard: async ({ branchId }) => ({
    ...loadResult,
    branch: snapshot.branches[branchId],
    messages: bootstrap.initialMessagesByBranch[branchId],
  }),
  loadCanvasBranchCard: async ({ branchId }) => ({
    ...loadResult,
    branch: snapshot.branches[branchId],
    messages: bootstrap.initialMessagesByBranch[branchId],
  }),
  renameBranch: unsupported,
  deleteBranch: unsupported,
  saveBranchNote: unsupported,
  saveComposerDraft: async () => null,
  sendMessage: unsupported,
  cancelMessage: unsupported,
  getAttachmentConstraints: unsupported,
  createAttachment: unsupported,
  removeAttachment: unsupported,
  transcribeAudio: unsupported,
  getGeneratedImageUrl: unsupported,
  saveGeneratedImage: unsupported,
  retryGeneratedImage: unsupported,
  getAccountState: async () => bootstrap.account,
  startChatGptLogin: unsupported,
  cancelChatGptLogin: async () => undefined,
  logoutChatGpt: unsupported,
  exportArchive: unsupported,
  importArchive: unsupported,
  openExternal: async () => ({ opened: false }),
  subscribeStream: () => () => undefined,
});
