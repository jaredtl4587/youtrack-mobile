/* @flow */
import type {IssueActivity} from '../../flow/Activity';

type WithID = {id: string};

export const mergeActivities = (activities: Array<IssueActivity>) => {
  if (!activities || activities.length < 2) {
    return activities;
  }

  return removeEmptyActivities(
    activities.reduce(createActivitiesMerger(), [])
  );


  function createActivitiesMerger() {
    const activitiesMap = {};

    return (activities, activity) => {
      const k = key(activity);

      if (activitiesMap[k]) {
        update(activitiesMap[k], activity);
      } else {
        activitiesMap[k] = createMergedActivity(activity);
        activities.push(activitiesMap[k]);
      }

      return activities;
    };
  }


  function removeEmptyActivities(activities: Array<IssueActivity>): Array<IssueActivity> {
    return activities.filter(hasChanges);

    function hasChanges(mergedActivity: IssueActivity) {
      if (mergedActivity.added === mergedActivity.removed) {
        return false;
      }

      if (isMultiple(mergedActivity)) {
        return (
          (mergedActivity.added && mergedActivity.added.length) ||
          (mergedActivity.removed && mergedActivity.removed.length));
      }

      const bothNotNull = !!mergedActivity.added && !!mergedActivity.removed;
      const bothComplex = typeof mergedActivity.added === 'object' && typeof mergedActivity.removed === 'object';

      return (
        (bothNotNull && bothComplex) ?
          // $FlowFixMe
          mergedActivity.added.id !== mergedActivity.removed.id :
          true
      );
    }
  }


  function update(mergedActivity: IssueActivity, activity: IssueActivity) {
    if (isMultiple(mergedActivity)) {
      // $FlowFixMe
      const addedRemoved = disjoint(mergedActivity.added, activity.removed || []);
      // $FlowFixMe
      const removedAdded = disjoint(mergedActivity.removed || [], activity.added);
      mergedActivity.added = merge(addedRemoved[0], removedAdded[1]);
      // $FlowFixMe
      mergedActivity.removed = merge(addedRemoved[1], removedAdded[0]);
    } else {
      mergedActivity.added = activity.added;
    }

    mergedActivity.timestamp = activity.timestamp;
    mergedActivity.id = activity.id;

    return mergedActivity;
  }


  function isMultiple(activity: IssueActivity) {
    return Array.isArray(activity.added) || Array.isArray(activity.removed);
  }


  function createMergedActivity(activity: IssueActivity) {
    return Object.create(activity);
  }


  function key(activity: IssueActivity) {
    return `${activity.target.id}${activity.targetMember || ''}`;
  }


  function merge(A: Array<WithID>, B: Array<WithID>) {
    if (!A || !B) {
      return A || B;
    }
    return removeDuplicates(A.concat(B));
  }


  function removeDuplicates(A: Array<WithID>) {
    const idsMap = {};
    return A.filter((it) => (idsMap[it.id]) ? false : idsMap[it.id] = true);
  }


  function disjoint(A: Array<WithID>, B: Array<WithID>) {
    if (!A || !B) {
      return [A, B];
    }

    const inB = arrayToMap(B);

    A = A.filter(a => inB[a.id] ? !(delete inB[a.id]) : a);

    B = mapToArray(inB);
    return [A, B];
  }

  function arrayToMap(items: Array<WithID>) {
    return items.reduce((map, item) => {
      map[item.id] = item;
      return map;
    }, {});
  }

  function mapToArray(map) {
    return Object.keys(map).map(id => map[id]);
  }
};


