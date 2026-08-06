// Shared implementation lives in @workspace/session-activity so web and
// mobile stay in lockstep. Re-exported here to keep existing import paths.
export {
  ACTIVITY_PAGE_SIZE,
  appendActivityPage,
  emptyActivityState,
  hasMoreActivity,
  nextActivityOffset,
  type ActivityState,
} from '@workspace/session-activity';
