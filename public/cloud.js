export function createCloudStore(fetcher = fetch) {
  let snapshot;
  async function load() {
    const response = await fetcher('/api/state',{cache:'no-store'});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not load the saved ranking.');
    snapshot = value; return value;
  }
  async function change(mutator) {
    if (!snapshot?.canEdit) throw new Error('Sign in as Corey to edit this ranking.');
    for (let attempt=0;attempt<3;attempt++) {
      const next = mutator(structuredClone(snapshot.state));
      const response = await fetcher('/api/state',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({app:'cafe-index',version:1,...next,revision:snapshot.revision})});
      const value = await response.json();
      if (response.status === 409) { snapshot = {canEdit:true,state:value.state,revision:value.revision}; continue; }
      if (!response.ok) throw new Error(value.error || 'Save failed. Please try again.');
      snapshot=value; return value;
    }
    throw new Error('Another device is updating the collection. Please try again.');
  }
  return {load,change};
}
