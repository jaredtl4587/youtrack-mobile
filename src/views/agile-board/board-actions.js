/* @flow */
import * as types from './board-action-types';
import {notifyError, notify} from '../../components/notification/notification';
import type {AgileBoardRow, AgileColumn, BoardOnList, AgileUserProfile} from '../../flow/Agile';
import type {IssueFull, IssueOnList} from '../../flow/Issue';
import ServersideEvents from '../../components/api/api__serverside-events';
import type Api from '../../components/api/api';
import Router from '../../components/router/router';
import log from '../../components/log/log';
import usage from '../../components/usage/usage';
import {findIssueOnBoard} from './board-updaters';
import {LayoutAnimation} from 'react-native';
import {getGroupedSprints} from './agile-board__helper';

const PAGE_SIZE = 6;
const CATEGORY_NAME = 'Agile board';
const RECONNECT_TIMEOUT = 60000;
let serverSideEventsInstance = null;

function startSprintLoad() {
  return {type: types.START_SPRINT_LOADING};
}

function stopSprintLoad() {
  return {type: types.STOP_SPRINT_LOADING};
}

function receiveSprint(sprint) {
  return {
    type: types.RECEIVE_SPRINT,
    sprint
  };
}

function noAgileSelected() {
  return {type: types.NO_AGILE_SELECTED};
}

type ApiGetter = () => Api;

function updateAgileUserProfile(sprintId) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const profile: AgileUserProfile = await getApi().agile.updateAgileUserProfile(sprintId);
    dispatch({
      type: types.RECEIVE_AGILE_PROFILE,
      profile
    });
  };
}

function loadSprint(agileId: string, sprintId: string) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const api: Api = getApi();
    dispatch(startSprintLoad());
    destroySSE();
    try {
      const sprint = await api.agile.getSprint(agileId, sprintId, PAGE_SIZE);
      layoutAnimation();
      dispatch(receiveSprint(sprint));
      dispatch(updateAgileUserProfile(sprint.id));
      dispatch(subscribeServersideUpdates());
      log.info(`Sprint ${sprintId} (agileBoardId="${agileId}") has been loaded`);
    } catch (e) {
      usage.trackEvent(CATEGORY_NAME, 'Load sprint', 'Error');
      //TODO(xi-eye): load last available
      notifyError('Could not load sprint', e);
    } finally {
      dispatch(stopSprintLoad());
    }
  };
}

function loadBoard(boardId: string, sprints: Array<{id: string}>) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const profile = getState().agile.profile;
    const visitedSprintOnBoard = (profile.visitedSprints || []).filter(s => s.agile.id === boardId)[0];
    const targetSprint = visitedSprintOnBoard || sprints[sprints.length - 1];
    log.info(`Resolving sprint for board ${boardId}. Visited = ${visitedSprintOnBoard ? visitedSprintOnBoard.id : 'NOTHING'}, target = ${targetSprint.id}`);
    dispatch(loadSprint(boardId, targetSprint.id));
  };
}

export function loadAgileProfile() {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const profile = await getApi().agile.getAgileUserProfile();
    dispatch({
      type: types.RECEIVE_AGILE_PROFILE,
      profile
    });
  };
}

export function fetchDefaultAgileBoard() {
  return async (dispatch: (any) => any, getState: () => Object) => {
    await dispatch(loadAgileProfile());
    try {
      const profile = getState().agile.profile;
      const lastSprint = profile.visitedSprints.filter(s => s.agile.id === profile.defaultAgile.id)[0];
      lastSprint && dispatch(loadSprint(lastSprint.agile.id, lastSprint.id));
    } catch (e) {
      dispatch(noAgileSelected());
      dispatch(stopSprintLoad());
    }
  };
}

function startSwimlanesLoading() {
  return {type: types.START_SWIMLANES_LOADING};
}

function stopSwimlanesLoading() {
  return {type: types.STOP_SWIMLANES_LOADING};
}

function receiveSwimlanes(swimlanes) {
  return {
    type: types.RECEIVE_SWIMLANES,
    PAGE_SIZE,
    swimlanes
  };
}

function setSSEInstance(sseInstance) {
  serverSideEventsInstance = sseInstance;
}

function destroySSE() {
  if (serverSideEventsInstance) {
    log.info('Destroying SSE');
    serverSideEventsInstance.close();
  }
  setSSEInstance(null);
}

function removeIssueFromBoard(issueId: string) {
  return {
    type: types.REMOVE_ISSUE_FROM_BOARD,
    issueId
  };
}

function moveIssue(movedId: string, cellId: string, leadingId: ?string) {
  return {
    type: types.MOVE_ISSUE,
    movedId,
    cellId,
    leadingId
  };
}

export function fetchMoreSwimlanes() {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint, noMoreSwimlanes, isLoadingMore} = getState().agile;
    const api: Api = getApi();
    if (!sprint || noMoreSwimlanes || isLoadingMore) {
      return;
    }
    dispatch(startSwimlanesLoading());

    try {
      const swimlanes = await api.agile.getSwimlanes(sprint.agile.id,
        sprint.id,
        PAGE_SIZE,
        sprint.board.trimmedSwimlanes.length);
      dispatch(receiveSwimlanes(swimlanes));
      log.info(`Loaded ${swimlanes.length} more swimlanes`);
      usage.trackEvent(CATEGORY_NAME, 'Load more swimlanes');
    } catch (e) {
      notifyError('Could not load swimlanes', e);
    } finally {
      dispatch(stopSwimlanesLoading());
    }
  };
}

function updateRowCollapsedState(row, newCollapsed: boolean) {
  layoutAnimation();
  return {
    type: types.ROW_COLLAPSE_TOGGLE,
    row,
    newCollapsed
  };
}

export function rowCollapseToggle(row: AgileBoardRow) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint} = getState().agile;
    const api: Api = getApi();
    if (!sprint) {
      return;
    }
    const oldCollapsed = row.collapsed;

    dispatch(updateRowCollapsedState(row, !row.collapsed));

    try {
      await api.agile.updateRowCollapsedState(sprint.agile.id, sprint.id, {
        ...row,
        collapsed: !row.collapsed
      });
      log.info(`Collapse state successfully updated for row ${row.id}, new state = ${!row.collapsed}`);
      usage.trackEvent(CATEGORY_NAME, 'Toggle row collapsing');
    } catch (e) {
      dispatch(updateRowCollapsedState(row, oldCollapsed));
      notifyError('Could not update row', e);
    }
  };
}

function updateColumnCollapsedState(column, newCollapsed: boolean) {
  layoutAnimation();
  return {
    type: types.COLUMN_COLLAPSE_TOGGLE,
    column,
    newCollapsed
  };
}

export function columnCollapseToggle(column: AgileColumn) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint} = getState().agile;
    const api = getApi();
    if (!sprint) {
      return;
    }
    const oldCollapsed = column.collapsed;

    dispatch(updateColumnCollapsedState(column, !column.collapsed));

    try {
      await api.agile.updateColumnCollapsedState(sprint.agile.id, sprint.id, {
        ...column,
        collapsed: !column.collapsed
      });
      log.info(`Collapse state successfully updated for column ${column.id}, new state = ${!column.collapsed}`);
      usage.trackEvent(CATEGORY_NAME, 'Toggle column collapsing');
    } catch (e) {
      dispatch(updateColumnCollapsedState(column, oldCollapsed));
      notifyError('Could not update column', e);
    }
  };
}

export function closeSelect() {
  return {type: types.CLOSE_AGILE_SELECT};
}

export function openSprintSelect() {
  return (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint} = getState().agile;
    const api: Api = getApi();
    if (!sprint) {
      return;
    }
    usage.trackEvent(CATEGORY_NAME, 'Open sprint select');

    dispatch({
      type: types.OPEN_AGILE_SELECT,
      selectProps: {
        show: true,
        placeholder: 'Search for the sprint',
        dataSource: async () => {
          const sprints = await api.agile.getSprintList(sprint.agile.id);
          return getGroupedSprints(sprints);
        },
        selectedItems: [sprint],
        getTitle: sprint => `${sprint.name} ${sprint.archived ? '(archived)' : ''}`,
        onSelect: selectedSprint => {
          dispatch(closeSelect());
          dispatch(loadSprint(sprint.agile.id, selectedSprint.id));
          usage.trackEvent(CATEGORY_NAME, 'Change sprint');
        }
      }
    });
  };
}

export function openBoardSelect() {
  return (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const api: Api = getApi();
    const {sprint} = getState().agile;
    usage.trackEvent(CATEGORY_NAME, 'Open board select');

    dispatch({
      type: types.OPEN_AGILE_SELECT,
      selectProps: {
        show: true,
        placeholder: 'Search for the board',
        dataSource: async () => {
          const agileBoardsList = await api.agile.getAgileBoardsList();
          const boards = agileBoardsList.sort(sortByName).reduce((list, board) => {
            if (board.favorite) {
              list.favorites.push(board);
            } else {
              list.regular.push(board);
            }
            return list;
          }, {favorites: [], regular: []});
          return [].concat(boards.favorites).concat(boards.regular);
        },
        selectedItems: sprint ? [sprint.agile] : [],
        onSelect: (selectedBoard: BoardOnList) => {
          dispatch(closeSelect());
          dispatch(loadBoard(selectedBoard.id, selectedBoard.sprints));
          usage.trackEvent(CATEGORY_NAME, 'Change board');
        }
      }
    });

    function sortByName(item1, item2) {
      if (item1.name > item2.name) {
        return 1;
      }
      if (item1.name < item2.name) {
        return -1;
      }
      return 0;
    }
  };
}

export function addCardToCell(cellId: string, issue: IssueFull) {
  return {
    type: types.ADD_CARD_TO_CELL,
    cellId,
    issue
  };
}

export function reorderSwimlanesOrCells(leadingId: ?string, movedId: string) {
  return {
    type: types.REORDER_SWIMLANES_OR_CELLS,
    leadingId,
    movedId
  };
}

export function addOrUpdateCellOnBoard(issue: IssueOnList, rowId: string, columnId: string) {
  return {
    type: types.ADD_OR_UPDATE_CELL_ON_BOARD,
    issue,
    rowId,
    columnId
  };
}

export function updateSwimlane(swimlane: AgileBoardRow) {
  return {
    type: types.UPDATE_SWIMLANE,
    swimlane
  };
}

export function storeCreatingIssueDraft(draftId: string, cellId: string) {
  return {
    type: types.STORE_CREATING_ISSUE_DRAFT,
    draftId,
    cellId
  };
}

export function createCardForCell(columnId: string, cellId: string) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint} = getState().agile;
    const api: Api = getApi();
    try {
      const draft = await api.agile.getIssueDraftForAgileCell(sprint.agile.id, sprint.id, columnId, cellId);
      dispatch(storeCreatingIssueDraft(draft.id, cellId));
      Router.CreateIssue({predefinedDraftId: draft.id});
      usage.trackEvent(CATEGORY_NAME, 'Open create card for cell');
    } catch (err) {
      notifyError('Could not create card', err);
    }
  };
}

export function subscribeServersideUpdates() {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint} = getState().agile;
    const api: Api = getApi();

    serverSideEventsInstance = new ServersideEvents(api.config.backendUrl);
    serverSideEventsInstance.subscribeAgileBoardUpdates(sprint.eventSourceTicket);

    serverSideEventsInstance.listenTo('error', () => {
      setTimeout(() => {
        log.info('Reloading sprint and reconnecting to LiveUpdate...');
        dispatch(loadSprint(sprint.agile.id, sprint.id));
      }, RECONNECT_TIMEOUT);
    });

    serverSideEventsInstance.listenTo('sprintCellUpdate', data => {
      layoutAnimation();
      dispatch(addOrUpdateCellOnBoard(data.issue, data.row.id, data.column.id));
    });

    serverSideEventsInstance.listenTo('sprintSwimlaneUpdate', data => {
      layoutAnimation();
      dispatch(updateSwimlane(data.swimlane));
    });

    serverSideEventsInstance.listenTo('sprintIssueRemove', data => {
      layoutAnimation();
      dispatch(removeIssueFromBoard(data.removedIssue.id));
    });

    serverSideEventsInstance.listenTo('sprintIssueHide', data => {
      layoutAnimation();
      dispatch(removeIssueFromBoard(data.removedIssue.id));
    });

    serverSideEventsInstance.listenTo('sprintIssueMessage', function (data) {
      data.messages.forEach(msg => notify(msg));
    });

    serverSideEventsInstance.listenTo('sprintIssuesReorder', data => {
      layoutAnimation();
      data.reorders.forEach(function (reorder) {
        const leadingId = reorder.leading ? reorder.leading.id : null;
        dispatch(reorderSwimlanesOrCells(leadingId, reorder.moved.id));
      });
    });

    setSSEInstance(serverSideEventsInstance);
  };
}

export function onCardDrop(data: { columnId: string, cellId: string, leadingId: ?string, movedId: string }) {
  return async (dispatch: (any) => any, getState: () => Object, getApi: ApiGetter) => {
    const {sprint} = getState().agile;
    const api: Api = getApi();

    const issueOnBoard = findIssueOnBoard(getState().agile.sprint.board, data.movedId);
    if (!issueOnBoard) {
      log.warn('Cannot find dragged issue on board');
      return;
    }

    const currentIndex = issueOnBoard.cell.issues.indexOf(issueOnBoard.issue);
    const currentLeading = issueOnBoard.cell.issues[currentIndex - 1];
    if (
      issueOnBoard.cell.id === data.cellId &&
      currentLeading?.id === data.leadingId
    ) {
      log.info('Card dropped to original position');
      return;
    }

    try {
      log.info(`Applying issue move: movedId="${data.movedId}", cellId="${data.cellId}", leadingId="${data.leadingId || ''}"`);
      layoutAnimation();
      dispatch(moveIssue(data.movedId, data.cellId, data.leadingId));

      await api.agile.updateCardPosition(
        sprint.agile.id,
        sprint.id,
        data.columnId,
        data.cellId,
        data.leadingId,
        data.movedId
      );

      usage.trackEvent(CATEGORY_NAME, 'Card drop');
    } catch (err) {
      dispatch(moveIssue(data.movedId, issueOnBoard.cell.id, currentLeading?.id));
      notifyError('Could not move card', err);
    }
  };
}

function layoutAnimation() { //https://github.com/facebook/react-native/issues/13984
  if (!layoutAnimation.layoutAnimationActive) {
    layoutAnimation.layoutAnimationActive = true;
    const effect = LayoutAnimation.Presets.easeInEaseOut;
    effect && LayoutAnimation.configureNext(
      effect,
      () => { layoutAnimation.layoutAnimationActive = null; }
    );
  }
}
