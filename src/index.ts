import { BufferAttribute, BufferGeometry, Material, Mesh } from 'three'
import { IFCLoader } from 'web-ifc-three'

type IndexesKey = string | number

type IndexCreater = (property: any) => Promise<IndexesKey> | IndexesKey

type IndexesData = {
  expressID: number,
  mesh?: Mesh,
}

type Indexes = Map<IndexesKey, IndexesData>


export const Mesh_CUSTOM_ID = 'GetMesh_CustomID'

/**
 * 
 * @param ifcLoader 
 * @param modelID 
 * @param expressID 
 * @see https://stackoverflow.com/questions/73264319/how-to-access-the-buffergeometry-of-ifc-items-in-web-ifc-three
 */
export function getMeshByExpressID(ifcLoader: IFCLoader, modelID: number, expressID: number) {
  const coordinates = [];
  const expressIDs = [];
  const newIndices = [];

  const alreadySaved = new Map();

  // Get the subset for the wall
  
  const subset = ifcLoader.ifcManager.createSubset({
      ids: [expressID],
      modelID,
      removePrevious: true,
      customID: Mesh_CUSTOM_ID
  });

  // Subsets have their own index, but share the BufferAttributes 
  // with the original geometry, so we need to rebuild a new 
  // geometry with this index

  const positionAttr = subset.geometry.attributes.position;
  const expressIDAttr = subset.geometry.attributes.expressID;

  const newGroups = subset.geometry.groups
      .filter((group) => group.count !== 0);

  const newMaterials: Material[] = [];
  const prevMaterials = subset.material;
  let newMaterialIndex = 0;

  newGroups.forEach((group) => {
    // @ts-ignore
    newMaterials.push(prevMaterials[group.materialIndex]);
    group.materialIndex = newMaterialIndex++;
  })

  let newIndex = 0;
  if (!subset.geometry.index) {
    return undefined
  }
  for (let i = 0; i < subset.geometry.index.count; i++) {
      const index = subset.geometry.index.array[i];

      if (!alreadySaved.has(index)) {
          coordinates.push(positionAttr.array[3 * index]);
          coordinates.push(positionAttr.array[3 * index + 1]);
          coordinates.push(positionAttr.array[3 * index + 2]);

          expressIDs.push(expressIDAttr.getX(index));
          alreadySaved.set(index, newIndex++);
      }

      const saved = alreadySaved.get(index);
      newIndices.push(saved);
  }

  const geometryToExport = new BufferGeometry();
  const newVerticesAttr = new BufferAttribute(Float32Array.from(coordinates), 3);
  const newExpressIDAttr = new BufferAttribute(Uint32Array.from(expressIDs), 1);

  geometryToExport.setAttribute('position', newVerticesAttr);
  geometryToExport.setAttribute('expressID', newExpressIDAttr);
  geometryToExport.setIndex(newIndices);
  geometryToExport.groups = newGroups;
  geometryToExport.computeVertexNormals();

  ifcLoader.ifcManager.removeSubset(modelID, undefined, Mesh_CUSTOM_ID);

  return new Mesh(geometryToExport, newMaterials);

}


/**
 * 
 * @param ifcLoader 
 * @param modelID 
 * @param types 
 * @param indexCreater 
 */
export async function createPropertyIndexes(ifcLoader: IFCLoader, modelID: number, types: number[], indexCreater: IndexCreater) {
  
  const indexes: Indexes = new Map()
  
  const expressIDs = (await Promise.all(
      types.map(async type => await ifcLoader.ifcManager.getAllItemsOfType(modelID, type, false))
  )).flat()

  for (const expressID of expressIDs) {

    const propertySets = await ifcLoader.ifcManager.getPropertySets(modelID, expressID)

    for (const property of propertySets) {
      const indexesKey = await indexCreater(property)
      
      if (indexesKey) {

        indexes.set(indexesKey, {
          expressID,
          mesh: getMeshByExpressID(ifcLoader, modelID, expressID)
        })
      }
    
    }
  }

  return indexes
    
}