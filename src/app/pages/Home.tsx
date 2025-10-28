import type { AppRequestInfo } from "@/worker";

import { ConversationPage } from "./conversation/ConversationPage";

export const Home = async (requestInfo: AppRequestInfo) => {
  return ConversationPage(requestInfo);
};
