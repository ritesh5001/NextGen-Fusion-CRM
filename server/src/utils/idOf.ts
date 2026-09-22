/** Returns the string id of a Mongoose ref whether populated (a doc) or not (an ObjectId). */
export function idOf(ref: unknown): string {
  if (!ref) return '';
  if (typeof ref === 'object' && ref !== null && '_id' in ref) {
    return String((ref as { _id: unknown })._id);
  }
  return String(ref);
}
