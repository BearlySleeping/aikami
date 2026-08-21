// AUTO-GENERATED
declare module "godot" {
    namespace NavigationPathQueryParameters2D {
        enum PathfindingAlgorithm {
            /** The path query uses the default A* pathfinding algorithm. */
            PATHFINDING_ALGORITHM_ASTAR = 0,
        }
        enum PathPostProcessing {
            /** Applies a funnel algorithm to the raw path corridor found by the pathfinding algorithm. This will result in the shortest path possible inside the path corridor. This postprocessing very much depends on the navigation mesh polygon layout and the created corridor. Especially tile- or gridbased layouts can face artificial corners with diagonal movement due to a jagged path corridor imposed by the cell shapes. */
            PATH_POSTPROCESSING_CORRIDORFUNNEL = 0,
            
            /** Centers every path position in the middle of the traveled navigation mesh polygon edge. This creates better paths for tile- or gridbased layouts that restrict the movement to the cells center. */
            PATH_POSTPROCESSING_EDGECENTERED = 1,
            
            /** Applies no postprocessing and returns the raw path corridor as found by the pathfinding algorithm. */
            PATH_POSTPROCESSING_NONE = 2,
        }
        enum PathMetadataFlags {
            /** Don't include any additional metadata about the returned path. */
            PATH_METADATA_INCLUDE_NONE = 0,
            
            /** Include the type of navigation primitive (region or link) that each point of the path goes through. */
            PATH_METADATA_INCLUDE_TYPES = 1,
            
            /** Include the [RID]s of the regions and links that each point of the path goes through. */
            PATH_METADATA_INCLUDE_RIDS = 2,
            
            /** Include the `ObjectID`s of the [Object]s which manage the regions and links each point of the path goes through. */
            PATH_METADATA_INCLUDE_OWNERS = 4,
            
            /** Include all available metadata about the returned path. */
            PATH_METADATA_INCLUDE_ALL = 7,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationPathQueryParameters2D extends __NameMapRefCounted {
    }
    /** Provides parameters for 2D navigation path queries.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationpathqueryparameters2d.html  
     */
    class NavigationPathQueryParameters2D extends RefCounted {
        constructor(identifier?: any)
        /** The navigation map [RID] used in the path query. */
        get map(): RID
        set map(value: RID)
        
        /** The pathfinding start position in global coordinates. */
        get start_position(): Vector2
        set start_position(value: Vector2)
        
        /** The pathfinding target position in global coordinates. */
        get target_position(): Vector2
        set target_position(value: Vector2)
        
        /** The navigation layers the query will use (as a bitmask). */
        get navigation_layers(): int64
        set navigation_layers(value: int64)
        
        /** The pathfinding algorithm used in the path query. */
        get pathfinding_algorithm(): int64
        set pathfinding_algorithm(value: int64)
        
        /** The path postprocessing applied to the raw path corridor found by the [member pathfinding_algorithm]. */
        get path_postprocessing(): int64
        set path_postprocessing(value: int64)
        
        /** Additional information to include with the navigation path. */
        get metadata_flags(): int64
        set metadata_flags(value: int64)
        
        /** If `true` a simplified version of the path will be returned with less critical path points removed. The simplification amount is controlled by [member simplify_epsilon]. The simplification uses a variant of Ramer-Douglas-Peucker algorithm for curve point decimation.  
         *  Path simplification can be helpful to mitigate various path following issues that can arise with certain agent types and script behaviors. E.g. "steering" agents or avoidance in "open fields".  
         */
        get simplify_path(): boolean
        set simplify_path(value: boolean)
        
        /** The path simplification amount in worlds units. */
        get simplify_epsilon(): float64
        set simplify_epsilon(value: float64)
        
        /** The list of region [RID]s that will be excluded from the path query. Use [method NavigationRegion2D.get_rid] to get the [RID] associated with a [NavigationRegion2D] node.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then set it to the property again.  
         */
        get excluded_regions(): GArray<RID>
        set excluded_regions(value: GArray<RID>)
        
        /** The list of region [RID]s that will be included by the path query. Use [method NavigationRegion2D.get_rid] to get the [RID] associated with a [NavigationRegion2D] node. If left empty all regions are included. If a region ends up being both included and excluded at the same time it will be excluded.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then set it to the property again.  
         */
        get included_regions(): GArray<RID>
        set included_regions(value: GArray<RID>)
        
        /** The maximum allowed length of the returned path in world units. A path will be clipped when going over this length. A value of `0` or below counts as disabled. */
        get path_return_max_length(): float64
        set path_return_max_length(value: float64)
        
        /** The maximum allowed radius in world units that the returned path can be from the path start. The path will be clipped when going over this radius. A value of `0` or below counts as disabled.  
         *      
         *  **Note:** This will perform a circle shaped clip operation on the path with the first path position being the circle's center position.  
         */
        get path_return_max_radius(): float64
        set path_return_max_radius(value: float64)
        
        /** The maximum number of polygons that are searched before the pathfinding cancels the search for a path to the (possibly unreachable or very far away) target position polygon. In this case the pathfinding resets and builds a path from the start polygon to the polygon that was found closest to the target position so far. A value of `0` or below counts as unlimited. In case of unlimited the pathfinding will search all polygons connected with the start polygon until either the target position polygon is found or all available polygon search options are exhausted. */
        get path_search_max_polygons(): int64
        set path_search_max_polygons(value: int64)
        
        /** The maximum distance a searched polygon can be away from the start polygon before the pathfinding cancels the search for a path to the (possibly unreachable or very far away) target position polygon. In this case the pathfinding resets and builds a path from the start polygon to the polygon that was found closest to the target position so far. A value of `0` or below counts as unlimited. In case of unlimited the pathfinding will search all polygons connected with the start polygon until either the target position polygon is found or all available polygon search options are exhausted. */
        get path_search_max_distance(): float64
        set path_search_max_distance(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationPathQueryParameters2D;
    }
    namespace NavigationPathQueryParameters3D {
        enum PathfindingAlgorithm {
            /** The path query uses the default A* pathfinding algorithm. */
            PATHFINDING_ALGORITHM_ASTAR = 0,
        }
        enum PathPostProcessing {
            /** Applies a funnel algorithm to the raw path corridor found by the pathfinding algorithm. This will result in the shortest path possible inside the path corridor. This postprocessing very much depends on the navigation mesh polygon layout and the created corridor. Especially tile- or gridbased layouts can face artificial corners with diagonal movement due to a jagged path corridor imposed by the cell shapes. */
            PATH_POSTPROCESSING_CORRIDORFUNNEL = 0,
            
            /** Centers every path position in the middle of the traveled navigation mesh polygon edge. This creates better paths for tile- or gridbased layouts that restrict the movement to the cells center. */
            PATH_POSTPROCESSING_EDGECENTERED = 1,
            
            /** Applies no postprocessing and returns the raw path corridor as found by the pathfinding algorithm. */
            PATH_POSTPROCESSING_NONE = 2,
        }
        enum PathMetadataFlags {
            /** Don't include any additional metadata about the returned path. */
            PATH_METADATA_INCLUDE_NONE = 0,
            
            /** Include the type of navigation primitive (region or link) that each point of the path goes through. */
            PATH_METADATA_INCLUDE_TYPES = 1,
            
            /** Include the [RID]s of the regions and links that each point of the path goes through. */
            PATH_METADATA_INCLUDE_RIDS = 2,
            
            /** Include the `ObjectID`s of the [Object]s which manage the regions and links each point of the path goes through. */
            PATH_METADATA_INCLUDE_OWNERS = 4,
            
            /** Include all available metadata about the returned path. */
            PATH_METADATA_INCLUDE_ALL = 7,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationPathQueryParameters3D extends __NameMapRefCounted {
    }
    /** Provides parameters for 3D navigation path queries.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationpathqueryparameters3d.html  
     */
    class NavigationPathQueryParameters3D extends RefCounted {
        constructor(identifier?: any)
        /** The navigation map [RID] used in the path query. */
        get map(): RID
        set map(value: RID)
        
        /** The pathfinding start position in global coordinates. */
        get start_position(): Vector3
        set start_position(value: Vector3)
        
        /** The pathfinding target position in global coordinates. */
        get target_position(): Vector3
        set target_position(value: Vector3)
        
        /** The navigation layers the query will use (as a bitmask). */
        get navigation_layers(): int64
        set navigation_layers(value: int64)
        
        /** The pathfinding algorithm used in the path query. */
        get pathfinding_algorithm(): int64
        set pathfinding_algorithm(value: int64)
        
        /** The path postprocessing applied to the raw path corridor found by the [member pathfinding_algorithm]. */
        get path_postprocessing(): int64
        set path_postprocessing(value: int64)
        
        /** Additional information to include with the navigation path. */
        get metadata_flags(): int64
        set metadata_flags(value: int64)
        
        /** If `true` a simplified version of the path will be returned with less critical path points removed. The simplification amount is controlled by [member simplify_epsilon]. The simplification uses a variant of Ramer-Douglas-Peucker algorithm for curve point decimation.  
         *  Path simplification can be helpful to mitigate various path following issues that can arise with certain agent types and script behaviors. E.g. "steering" agents or avoidance in "open fields".  
         */
        get simplify_path(): boolean
        set simplify_path(value: boolean)
        
        /** The path simplification amount in worlds units. */
        get simplify_epsilon(): float64
        set simplify_epsilon(value: float64)
        
        /** The list of region [RID]s that will be excluded from the path query. Use [method NavigationRegion3D.get_rid] to get the [RID] associated with a [NavigationRegion3D] node.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then set it to the property again.  
         */
        get excluded_regions(): GArray<RID>
        set excluded_regions(value: GArray<RID>)
        
        /** The list of region [RID]s that will be included by the path query. Use [method NavigationRegion3D.get_rid] to get the [RID] associated with a [NavigationRegion3D] node. If left empty all regions are included. If a region ends up being both included and excluded at the same time it will be excluded.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then set it to the property again.  
         */
        get included_regions(): GArray<RID>
        set included_regions(value: GArray<RID>)
        
        /** The maximum allowed length of the returned path in world units. A path will be clipped when going over this length. A value of `0` or below counts as disabled. */
        get path_return_max_length(): float64
        set path_return_max_length(value: float64)
        
        /** The maximum allowed radius in world units that the returned path can be from the path start. The path will be clipped when going over this radius. A value of `0` or below counts as disabled.  
         *      
         *  **Note:** This will perform a sphere shaped clip operation on the path with the first path position being the sphere's center position.  
         */
        get path_return_max_radius(): float64
        set path_return_max_radius(value: float64)
        
        /** The maximum number of polygons that are searched before the pathfinding cancels the search for a path to the (possibly unreachable or very far away) target position polygon. In this case the pathfinding resets and builds a path from the start polygon to the polygon that was found closest to the target position so far. A value of `0` or below counts as unlimited. In case of unlimited the pathfinding will search all polygons connected with the start polygon until either the target position polygon is found or all available polygon search options are exhausted. */
        get path_search_max_polygons(): int64
        set path_search_max_polygons(value: int64)
        
        /** The maximum distance a searched polygon can be away from the start polygon before the pathfinding cancels the search for a path to the (possibly unreachable or very far away) target position polygon. In this case the pathfinding resets and builds a path from the start polygon to the polygon that was found closest to the target position so far. A value of `0` or below counts as unlimited. In case of unlimited the pathfinding will search all polygons connected with the start polygon until either the target position polygon is found or all available polygon search options are exhausted. */
        get path_search_max_distance(): float64
        set path_search_max_distance(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationPathQueryParameters3D;
    }
    namespace NavigationPathQueryResult2D {
        enum PathSegmentType {
            /** This segment of the path goes through a region. */
            PATH_SEGMENT_TYPE_REGION = 0,
            
            /** This segment of the path goes through a link. */
            PATH_SEGMENT_TYPE_LINK = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationPathQueryResult2D extends __NameMapRefCounted {
    }
    /** Represents the result of a 2D pathfinding query.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationpathqueryresult2d.html  
     */
    class NavigationPathQueryResult2D extends RefCounted {
        constructor(identifier?: any)
        /** Reset the result object to its initial state. This is useful to reuse the object across multiple queries. */
        reset(): void
        
        /** The resulting path array from the navigation query. All path array positions are in global coordinates. Without customized query parameters this is the same path as returned by [method NavigationServer2D.map_get_path]. */
        get path(): PackedVector2Array
        set path(value: PackedVector2Array | Vector2[])
        
        /** The type of navigation primitive (region or link) that each point of the path goes through. */
        get path_types(): PackedInt32Array
        set path_types(value: PackedInt32Array | int32[])
        
        /** The [RID]s of the regions and links that each point of the path goes through. */
        get path_rids(): GArray<RID>
        set path_rids(value: GArray<RID>)
        
        /** The `ObjectID`s of the [Object]s which manage the regions and links each point of the path goes through. */
        get path_owner_ids(): PackedInt64Array
        set path_owner_ids(value: PackedInt64Array | int64[])
        
        /** Returns the length of the path. */
        get path_length(): float64
        set path_length(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationPathQueryResult2D;
    }
    namespace NavigationPathQueryResult3D {
        enum PathSegmentType {
            /** This segment of the path goes through a region. */
            PATH_SEGMENT_TYPE_REGION = 0,
            
            /** This segment of the path goes through a link. */
            PATH_SEGMENT_TYPE_LINK = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationPathQueryResult3D extends __NameMapRefCounted {
    }
    /** Represents the result of a 3D pathfinding query.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationpathqueryresult3d.html  
     */
    class NavigationPathQueryResult3D extends RefCounted {
        constructor(identifier?: any)
        /** Reset the result object to its initial state. This is useful to reuse the object across multiple queries. */
        reset(): void
        
        /** The resulting path array from the navigation query. All path array positions are in global coordinates. Without customized query parameters this is the same path as returned by [method NavigationServer3D.map_get_path]. */
        get path(): PackedVector3Array
        set path(value: PackedVector3Array | Vector3[])
        
        /** The type of navigation primitive (region or link) that each point of the path goes through. */
        get path_types(): PackedInt32Array
        set path_types(value: PackedInt32Array | int32[])
        
        /** The [RID]s of the regions and links that each point of the path goes through. */
        get path_rids(): GArray<RID>
        set path_rids(value: GArray<RID>)
        
        /** The `ObjectID`s of the [Object]s which manage the regions and links each point of the path goes through. */
        get path_owner_ids(): PackedInt64Array
        set path_owner_ids(value: PackedInt64Array | int64[])
        
        /** Returns the length of the path. */
        get path_length(): float64
        set path_length(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationPathQueryResult3D;
    }
    namespace NavigationPolygon {
        enum SamplePartitionType {
            /** Convex partitioning that results in a navigation mesh with convex polygons. */
            SAMPLE_PARTITION_CONVEX_PARTITION = 0,
            
            /** Triangulation partitioning that results in a navigation mesh with triangle polygons. */
            SAMPLE_PARTITION_TRIANGULATE = 1,
            
            /** Represents the size of the [enum SamplePartitionType] enum. */
            SAMPLE_PARTITION_MAX = 2,
        }
        enum ParsedGeometryType {
            /** Parses mesh instances as obstruction geometry. This includes [Polygon2D], [MeshInstance2D], [MultiMeshInstance2D], and [TileMap] nodes.  
             *  Meshes are only parsed when they use a 2D vertices surface format.  
             */
            PARSED_GEOMETRY_MESH_INSTANCES = 0,
            
            /** Parses [StaticBody2D] and [TileMap] colliders as obstruction geometry. The collider should be in any of the layers specified by [member parsed_collision_mask]. */
            PARSED_GEOMETRY_STATIC_COLLIDERS = 1,
            
            /** Both [constant PARSED_GEOMETRY_MESH_INSTANCES] and [constant PARSED_GEOMETRY_STATIC_COLLIDERS]. */
            PARSED_GEOMETRY_BOTH = 2,
            
            /** Represents the size of the [enum ParsedGeometryType] enum. */
            PARSED_GEOMETRY_MAX = 3,
        }
        enum SourceGeometryMode {
            /** Scans the child nodes of the root node recursively for geometry. */
            SOURCE_GEOMETRY_ROOT_NODE_CHILDREN = 0,
            
            /** Scans nodes in a group and their child nodes recursively for geometry. The group is specified by [member source_geometry_group_name]. */
            SOURCE_GEOMETRY_GROUPS_WITH_CHILDREN = 1,
            
            /** Uses nodes in a group for geometry. The group is specified by [member source_geometry_group_name]. */
            SOURCE_GEOMETRY_GROUPS_EXPLICIT = 2,
            
            /** Represents the size of the [enum SourceGeometryMode] enum. */
            SOURCE_GEOMETRY_MAX = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationPolygon extends __NameMapResource {
    }
    /** A 2D navigation mesh that describes a traversable surface for pathfinding.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationpolygon.html  
     */
    class NavigationPolygon extends Resource {
        constructor(identifier?: any)
        /** Adds a polygon using the indices of the vertices you get when calling [method get_vertices]. */
        add_polygon(polygon: PackedInt32Array | int32[]): void
        
        /** Returns the count of all polygons. */
        get_polygon_count(): int64
        
        /** Returns a [PackedInt32Array] containing the indices of the vertices of a created polygon. */
        get_polygon(idx: int64): PackedInt32Array
        
        /** Clears the array of polygons, but it doesn't clear the array of outlines and vertices. */
        clear_polygons(): void
        
        /** Returns the [NavigationMesh] resulting from this navigation polygon. This navigation mesh can be used to update the navigation mesh of a region with the [method NavigationServer3D.region_set_navigation_mesh] API directly. */
        get_navigation_mesh(): null | NavigationMesh
        
        /** Appends a [PackedVector2Array] that contains the vertices of an outline to the internal array that contains all the outlines. */
        add_outline(outline: PackedVector2Array | Vector2[]): void
        
        /** Adds a [PackedVector2Array] that contains the vertices of an outline to the internal array that contains all the outlines at a fixed position. */
        add_outline_at_index(outline: PackedVector2Array | Vector2[], index: int64): void
        
        /** Returns the number of outlines that were created in the editor or by script. */
        get_outline_count(): int64
        
        /** Changes an outline created in the editor or by script. You have to call [method make_polygons_from_outlines] for the polygons to update. */
        set_outline(idx: int64, outline: PackedVector2Array | Vector2[]): void
        
        /** Returns a [PackedVector2Array] containing the vertices of an outline that was created in the editor or by script. */
        get_outline(idx: int64): PackedVector2Array
        
        /** Removes an outline created in the editor or by script. You have to call [method make_polygons_from_outlines] for the polygons to update. */
        remove_outline(idx: int64): void
        
        /** Clears the array of the outlines, but it doesn't clear the vertices and the polygons that were created by them. */
        clear_outlines(): void
        
        /** Creates polygons from the outlines added in the editor or by script. */
        make_polygons_from_outlines(): void
        
        /** Based on [param value], enables or disables the specified layer in the [member parsed_collision_mask], given a [param layer_number] between 1 and 32. */
        set_parsed_collision_mask_value(layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified layer of the [member parsed_collision_mask] is enabled, given a [param layer_number] between 1 and 32. */
        get_parsed_collision_mask_value(layer_number: int64): boolean
        
        /** Clears the internal arrays for vertices and polygon indices. */
        clear(): void
        get vertices(): PackedVector2Array
        set vertices(value: PackedVector2Array | Vector2[])
        get polygons(): GArray
        set polygons(value: GArray)
        get outlines(): GArray
        set outlines(value: GArray)
        
        /** Partitioning algorithm for creating the navigation mesh polys. */
        get sample_partition_type(): int64
        set sample_partition_type(value: int64)
        
        /** Determines which type of nodes will be parsed as geometry. */
        get parsed_geometry_type(): int64
        set parsed_geometry_type(value: int64)
        
        /** The physics layers to scan for static colliders.  
         *  Only used when [member parsed_geometry_type] is [constant PARSED_GEOMETRY_STATIC_COLLIDERS] or [constant PARSED_GEOMETRY_BOTH].  
         */
        get parsed_collision_mask(): int64
        set parsed_collision_mask(value: int64)
        
        /** The source of the geometry used when baking. */
        get source_geometry_mode(): int64
        set source_geometry_mode(value: int64)
        
        /** The group name of nodes that should be parsed for baking source geometry.  
         *  Only used when [member source_geometry_mode] is [constant SOURCE_GEOMETRY_GROUPS_WITH_CHILDREN] or [constant SOURCE_GEOMETRY_GROUPS_EXPLICIT].  
         */
        get source_geometry_group_name(): string
        set source_geometry_group_name(value: string)
        
        /** The cell size used to rasterize the navigation mesh vertices. Must match with the cell size on the navigation map. */
        get cell_size(): float64
        set cell_size(value: float64)
        
        /** The size of the non-navigable border around the bake bounding area defined by the [member baking_rect] [Rect2].  
         *  In conjunction with the [member baking_rect] the border size can be used to bake tile aligned navigation meshes without the tile edges being shrunk by [member agent_radius].  
         */
        get border_size(): float64
        set border_size(value: float64)
        
        /** The distance to erode/shrink the walkable surface when baking the navigation mesh.  
         *      
         *  **Note:** The radius must be equal or higher than `0.0`. If the radius is `0.0`, it won't be possible to fix invalid outline overlaps and other precision errors during the baking process. As a result, some obstacles may be excluded incorrectly from the final navigation mesh, or may delete the navigation mesh's polygons.  
         */
        get agent_radius(): float64
        set agent_radius(value: float64)
        
        /** If the baking [Rect2] has an area the navigation mesh baking will be restricted to its enclosing area. */
        get baking_rect(): Rect2
        set baking_rect(value: Rect2)
        
        /** The position offset applied to the [member baking_rect] [Rect2]. */
        get baking_rect_offset(): Vector2
        set baking_rect_offset(value: Vector2)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationPolygon;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationRegion2D extends __NameMapNode2D {
    }
    /** A traversable 2D region that [NavigationAgent2D]s can use for pathfinding.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationregion2d.html  
     */
    class NavigationRegion2D<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** Returns the [RID] of this region on the [NavigationServer2D]. Combined with [method NavigationServer2D.map_get_closest_point_owner] can be used to identify the [NavigationRegion2D] closest to a point on the merged navigation map. */
        get_rid(): RID
        
        /** Sets the [RID] of the navigation map this region should use. By default the region will automatically join the [World2D] default navigation map so this function is only required to override the default map. */
        set_navigation_map(navigation_map: RID): void
        
        /** Returns the current navigation map [RID] used by this region. */
        get_navigation_map(): RID
        
        /** Based on [param value], enables or disables the specified layer in the [member navigation_layers] bitmask, given a [param layer_number] between 1 and 32. */
        set_navigation_layer_value(layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified layer of the [member navigation_layers] bitmask is enabled, given a [param layer_number] between 1 and 32. */
        get_navigation_layer_value(layer_number: int64): boolean
        
        /** Returns the [RID] of this region on the [NavigationServer2D]. */
        get_region_rid(): RID
        
        /** Bakes the [NavigationPolygon]. If [param on_thread] is set to `true` (default), the baking is done on a separate thread. */
        bake_navigation_polygon(on_thread?: boolean /* = true */): void
        
        /** Returns `true` when the [NavigationPolygon] is being baked on a background thread. */
        is_baking(): boolean
        _navigation_polygon_changed(): void
        
        /** Returns the axis-aligned rectangle for the region's transformed navigation mesh. */
        get_bounds(): Rect2
        
        /** The [NavigationPolygon] resource to use. */
        get navigation_polygon(): null | NavigationPolygon
        set navigation_polygon(value: null | NavigationPolygon)
        
        /** Determines if the [NavigationRegion2D] is enabled or disabled. */
        get enabled(): boolean
        set enabled(value: boolean)
        
        /** If enabled the navigation region will use edge connections to connect with other navigation regions within proximity of the navigation map edge connection margin. */
        get use_edge_connections(): boolean
        set use_edge_connections(value: boolean)
        
        /** A bitfield determining all navigation layers the region belongs to. These navigation layers can be checked upon when requesting a path with [method NavigationServer2D.map_get_path]. */
        get navigation_layers(): int64
        set navigation_layers(value: int64)
        
        /** When pathfinding enters this region's navigation mesh from another regions navigation mesh the [member enter_cost] value is added to the path distance for determining the shortest path. */
        get enter_cost(): float64
        set enter_cost(value: float64)
        
        /** When pathfinding moves inside this region's navigation mesh the traveled distances are multiplied with [member travel_cost] for determining the shortest path. */
        get travel_cost(): float64
        set travel_cost(value: float64)
        
        /** Emitted when the used navigation polygon is replaced or changes to the internals of the current navigation polygon are committed. */
        readonly navigation_polygon_changed: Signal<() => void>
        
        /** Emitted when a navigation polygon bake operation is completed. */
        readonly bake_finished: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationRegion2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNavigationRegion3D extends __NameMapNode3D {
    }
    /** A traversable 3D region that [NavigationAgent3D]s can use for pathfinding.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_navigationregion3d.html  
     */
    class NavigationRegion3D<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Returns the [RID] of this region on the [NavigationServer3D]. Combined with [method NavigationServer3D.map_get_closest_point_owner] can be used to identify the [NavigationRegion3D] closest to a point on the merged navigation map. */
        get_rid(): RID
        
        /** Sets the [RID] of the navigation map this region should use. By default the region will automatically join the [World3D] default navigation map so this function is only required to override the default map. */
        set_navigation_map(navigation_map: RID): void
        
        /** Returns the current navigation map [RID] used by this region. */
        get_navigation_map(): RID
        
        /** Based on [param value], enables or disables the specified layer in the [member navigation_layers] bitmask, given a [param layer_number] between 1 and 32. */
        set_navigation_layer_value(layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified layer of the [member navigation_layers] bitmask is enabled, given a [param layer_number] between 1 and 32. */
        get_navigation_layer_value(layer_number: int64): boolean
        
        /** Returns the [RID] of this region on the [NavigationServer3D]. */
        get_region_rid(): RID
        
        /** Bakes the [NavigationMesh]. If [param on_thread] is set to `true` (default), the baking is done on a separate thread. Baking on separate thread is useful because navigation baking is not a cheap operation. When it is completed, it automatically sets the new [NavigationMesh]. Please note that baking on separate thread may be very slow if geometry is parsed from meshes as async access to each mesh involves heavy synchronization. Also, please note that baking on a separate thread is automatically disabled on operating systems that cannot use threads (such as Web with threads disabled). */
        bake_navigation_mesh(on_thread?: boolean /* = true */): void
        
        /** Returns `true` when the [NavigationMesh] is being baked on a background thread. */
        is_baking(): boolean
        
        /** Returns the axis-aligned bounding box for the region's transformed navigation mesh. */
        get_bounds(): AABB
        
        /** The [NavigationMesh] resource to use. */
        get navigation_mesh(): null | NavigationMesh
        set navigation_mesh(value: null | NavigationMesh)
        
        /** Determines if the [NavigationRegion3D] is enabled or disabled. */
        get enabled(): boolean
        set enabled(value: boolean)
        
        /** If enabled the navigation region will use edge connections to connect with other navigation regions within proximity of the navigation map edge connection margin. */
        get use_edge_connections(): boolean
        set use_edge_connections(value: boolean)
        
        /** A bitfield determining all navigation layers the region belongs to. These navigation layers can be checked upon when requesting a path with [method NavigationServer3D.map_get_path]. */
        get navigation_layers(): int64
        set navigation_layers(value: int64)
        
        /** When pathfinding enters this region's navigation mesh from another regions navigation mesh the [member enter_cost] value is added to the path distance for determining the shortest path. */
        get enter_cost(): float64
        set enter_cost(value: float64)
        
        /** When pathfinding moves inside this region's navigation mesh the traveled distances are multiplied with [member travel_cost] for determining the shortest path. */
        get travel_cost(): float64
        set travel_cost(value: float64)
        
        /** Notifies when the [NavigationMesh] has changed. */
        readonly navigation_mesh_changed: Signal<() => void>
        
        /** Notifies when the navigation mesh bake operation is completed. */
        readonly bake_finished: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNavigationRegion3D;
    }
    namespace NinePatchRect {
        enum AxisStretchMode {
            /** Stretches the center texture across the NinePatchRect. This may cause the texture to be distorted. */
            AXIS_STRETCH_MODE_STRETCH = 0,
            
            /** Repeats the center texture across the NinePatchRect. This won't cause any visible distortion. The texture must be seamless for this to work without displaying artifacts between edges. */
            AXIS_STRETCH_MODE_TILE = 1,
            
            /** Repeats the center texture across the NinePatchRect, but will also stretch the texture to make sure each tile is visible in full. This may cause the texture to be distorted, but less than [constant AXIS_STRETCH_MODE_STRETCH]. The texture must be seamless for this to work without displaying artifacts between edges. */
            AXIS_STRETCH_MODE_TILE_FIT = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNinePatchRect extends __NameMapControl {
    }
    /** A control that displays a texture by keeping its corners intact, but tiling its edges and center.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_ninepatchrect.html  
     */
    class NinePatchRect<Map extends NodePathMap = any> extends Control<Map> {
        constructor(identifier?: any)
        /** Sets the size of the margin on the specified [enum Side] to [param value] pixels. */
        set_patch_margin(margin: Side, value: int64): void
        
        /** Returns the size of the margin on the specified [enum Side]. */
        get_patch_margin(margin: Side): int64
        
        /** The node's texture resource. */
        get texture(): null | Texture2D
        set texture(value: null | Texture2D)
        
        /** If `true`, draw the panel's center. Else, only draw the 9-slice's borders. */
        get draw_center(): boolean
        set draw_center(value: boolean)
        
        /** Rectangular region of the texture to sample from. If you're working with an atlas, use this property to define the area the 9-slice should use. All other properties are relative to this one. If the rect is empty, NinePatchRect will use the whole texture. */
        get region_rect(): Rect2
        set region_rect(value: Rect2)
        
        /** The width of the 9-slice's left column. A margin of 16 means the 9-slice's left corners and side will have a width of 16 pixels. You can set all 4 margin values individually to create panels with non-uniform borders. */
        get patch_margin_left(): int64
        set patch_margin_left(value: int64)
        
        /** The height of the 9-slice's top row. A margin of 16 means the 9-slice's top corners and side will have a height of 16 pixels. You can set all 4 margin values individually to create panels with non-uniform borders. */
        get patch_margin_top(): int64
        set patch_margin_top(value: int64)
        
        /** The width of the 9-slice's right column. A margin of 16 means the 9-slice's right corners and side will have a width of 16 pixels. You can set all 4 margin values individually to create panels with non-uniform borders. */
        get patch_margin_right(): int64
        set patch_margin_right(value: int64)
        
        /** The height of the 9-slice's bottom row. A margin of 16 means the 9-slice's bottom corners and side will have a height of 16 pixels. You can set all 4 margin values individually to create panels with non-uniform borders. */
        get patch_margin_bottom(): int64
        set patch_margin_bottom(value: int64)
        
        /** The stretch mode to use for horizontal stretching/tiling. */
        get axis_stretch_horizontal(): int64
        set axis_stretch_horizontal(value: int64)
        
        /** The stretch mode to use for vertical stretching/tiling. */
        get axis_stretch_vertical(): int64
        set axis_stretch_vertical(value: int64)
        
        /** Emitted when the node's texture changes. */
        readonly texture_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNinePatchRect;
    }
    namespace Node {
        enum ProcessMode {
            /** Inherits [member process_mode] from the node's parent. This is the default for any newly created node. */
            PROCESS_MODE_INHERIT = 0,
            
            /** Stops processing when [member SceneTree.paused] is `true`. This is the inverse of [constant PROCESS_MODE_WHEN_PAUSED], and the default for the root node. */
            PROCESS_MODE_PAUSABLE = 1,
            
            /** Process **only** when [member SceneTree.paused] is `true`. This is the inverse of [constant PROCESS_MODE_PAUSABLE]. */
            PROCESS_MODE_WHEN_PAUSED = 2,
            
            /** Always process. Keeps processing, ignoring [member SceneTree.paused]. This is the inverse of [constant PROCESS_MODE_DISABLED]. */
            PROCESS_MODE_ALWAYS = 3,
            
            /** Never process. Completely disables processing, ignoring [member SceneTree.paused]. This is the inverse of [constant PROCESS_MODE_ALWAYS]. */
            PROCESS_MODE_DISABLED = 4,
        }
        enum ProcessThreadGroup {
            /** Process this node based on the thread group mode of the first parent (or grandparent) node that has a thread group mode that is not inherit. See [member process_thread_group] for more information. */
            PROCESS_THREAD_GROUP_INHERIT = 0,
            
            /** Process this node (and child nodes set to inherit) on the main thread. See [member process_thread_group] for more information. */
            PROCESS_THREAD_GROUP_MAIN_THREAD = 1,
            
            /** Process this node (and child nodes set to inherit) on a sub-thread. See [member process_thread_group] for more information. */
            PROCESS_THREAD_GROUP_SUB_THREAD = 2,
        }
        enum ProcessThreadMessages {
            /** Allows this node to process threaded messages created with [method call_deferred_thread_group] right before [method _process] is called. */
            FLAG_PROCESS_THREAD_MESSAGES = 1,
            
            /** Allows this node to process threaded messages created with [method call_deferred_thread_group] right before [method _physics_process] is called. */
            FLAG_PROCESS_THREAD_MESSAGES_PHYSICS = 2,
            
            /** Allows this node to process threaded messages created with [method call_deferred_thread_group] right before either [method _process] or [method _physics_process] are called. */
            FLAG_PROCESS_THREAD_MESSAGES_ALL = 3,
        }
        enum PhysicsInterpolationMode {
            /** Inherits [member physics_interpolation_mode] from the node's parent. This is the default for any newly created node. */
            PHYSICS_INTERPOLATION_MODE_INHERIT = 0,
            
            /** Enables physics interpolation for this node and for children set to [constant PHYSICS_INTERPOLATION_MODE_INHERIT]. This is the default for the root node. */
            PHYSICS_INTERPOLATION_MODE_ON = 1,
            
            /** Disables physics interpolation for this node and for children set to [constant PHYSICS_INTERPOLATION_MODE_INHERIT]. */
            PHYSICS_INTERPOLATION_MODE_OFF = 2,
        }
        enum DuplicateFlags {
            /** Duplicate the node's signal connections that are connected with the [constant Object.CONNECT_PERSIST] flag. */
            DUPLICATE_SIGNALS = 1,
            
            /** Duplicate the node's groups. */
            DUPLICATE_GROUPS = 2,
            
            /** Duplicate the node's script (also overriding the duplicated children's scripts, if combined with [constant DUPLICATE_USE_INSTANTIATION]). */
            DUPLICATE_SCRIPTS = 4,
            
            /** Duplicate using [method PackedScene.instantiate]. If the node comes from a scene saved on disk, reuses [method PackedScene.instantiate] as the base for the duplicated node and its children. */
            DUPLICATE_USE_INSTANTIATION = 8,
            
            /** Duplicate also non-serializable variables (i.e. without [constant @GlobalScope.PROPERTY_USAGE_STORAGE]). */
            DUPLICATE_INTERNAL_STATE = 16,
            
            /** Duplicate using default flags. This constant is useful to add or remove a single flag.  
             *    
             */
            DUPLICATE_DEFAULT = 15,
        }
        enum InternalMode {
            /** The node will not be internal. */
            INTERNAL_MODE_DISABLED = 0,
            
            /** The node will be placed at the beginning of the parent's children, before any non-internal sibling. */
            INTERNAL_MODE_FRONT = 1,
            
            /** The node will be placed at the end of the parent's children, after any non-internal sibling. */
            INTERNAL_MODE_BACK = 2,
        }
        enum AutoTranslateMode {
            /** Inherits [member auto_translate_mode] from the node's parent. This is the default for any newly created node. */
            AUTO_TRANSLATE_MODE_INHERIT = 0,
            
            /** Always automatically translate. This is the inverse of [constant AUTO_TRANSLATE_MODE_DISABLED], and the default for the root node. */
            AUTO_TRANSLATE_MODE_ALWAYS = 1,
            
            /** Never automatically translate. This is the inverse of [constant AUTO_TRANSLATE_MODE_ALWAYS].  
             *  String parsing for translation template generation will be skipped for this node and children that are set to [constant AUTO_TRANSLATE_MODE_INHERIT].  
             */
            AUTO_TRANSLATE_MODE_DISABLED = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNode extends __NameMapObject {
    }
    namespace __PathMappableDummyKeys { const Node: unique symbol }
    /** Base class for all scene objects.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_node.html  
     */
    class Node<Map extends NodePathMap = any> extends Object implements PathMappable<typeof __PathMappableDummyKeys.Node, Map> {
        [__PathMappableDummyKeys.Node]: Map
        /** Notification received when the node enters a [SceneTree]. See [method _enter_tree].  
         *  This notification is received  *before*  the related [signal tree_entered] signal.  
         */
        static readonly NOTIFICATION_ENTER_TREE = 10
        
        /** Notification received when the node is about to exit a [SceneTree]. See [method _exit_tree].  
         *  This notification is received  *after*  the related [signal tree_exiting] signal.  
         *  This notification is sent in reversed order.  
         */
        static readonly NOTIFICATION_EXIT_TREE = 11
        static readonly NOTIFICATION_MOVED_IN_PARENT = 12
        
        /** Notification received when the node is ready. See [method _ready]. */
        static readonly NOTIFICATION_READY = 13
        
        /** Notification received when the node is paused. See [member process_mode]. */
        static readonly NOTIFICATION_PAUSED = 14
        
        /** Notification received when the node is unpaused. See [member process_mode]. */
        static readonly NOTIFICATION_UNPAUSED = 15
        
        /** Notification received from the tree every physics frame when [method is_physics_processing] returns `true`. See [method _physics_process]. */
        static readonly NOTIFICATION_PHYSICS_PROCESS = 16
        
        /** Notification received from the tree every rendered frame when [method is_processing] returns `true`. See [method _process]. */
        static readonly NOTIFICATION_PROCESS = 17
        
        /** Notification received when the node is set as a child of another node (see [method add_child] and [method add_sibling]).  
         *      
         *  **Note:** This does  *not*  mean that the node entered the [SceneTree].  
         */
        static readonly NOTIFICATION_PARENTED = 18
        
        /** Notification received when the parent node calls [method remove_child] on this node.  
         *      
         *  **Note:** This does  *not*  mean that the node exited the [SceneTree].  
         */
        static readonly NOTIFICATION_UNPARENTED = 19
        
        /** Notification received  *only*  by the newly instantiated scene root node, when [method PackedScene.instantiate] is completed. */
        static readonly NOTIFICATION_SCENE_INSTANTIATED = 20
        
        /** Notification received when a drag operation begins. All nodes receive this notification, not only the dragged one.  
         *  Can be triggered either by dragging a [Control] that provides drag data (see [method Control._get_drag_data]) or using [method Control.force_drag].  
         *  Use [method Viewport.gui_get_drag_data] to get the dragged data.  
         */
        static readonly NOTIFICATION_DRAG_BEGIN = 21
        
        /** Notification received when a drag operation ends.  
         *  Use [method Viewport.gui_is_drag_successful] to check if the drag succeeded.  
         */
        static readonly NOTIFICATION_DRAG_END = 22
        
        /** Notification received when the node's [member name] or one of its ancestors' [member name] is changed. This notification is  *not*  received when the node is removed from the [SceneTree]. */
        static readonly NOTIFICATION_PATH_RENAMED = 23
        
        /** Notification received when the list of children is changed. This happens when child nodes are added, moved or removed. */
        static readonly NOTIFICATION_CHILD_ORDER_CHANGED = 24
        
        /** Notification received from the tree every rendered frame when [method is_processing_internal] returns `true`. */
        static readonly NOTIFICATION_INTERNAL_PROCESS = 25
        
        /** Notification received from the tree every physics frame when [method is_physics_processing_internal] returns `true`. */
        static readonly NOTIFICATION_INTERNAL_PHYSICS_PROCESS = 26
        
        /** Notification received when the node enters the tree, just before [constant NOTIFICATION_READY] may be received. Unlike the latter, it is sent every time the node enters tree, not just once. */
        static readonly NOTIFICATION_POST_ENTER_TREE = 27
        
        /** Notification received when the node is disabled. See [constant PROCESS_MODE_DISABLED]. */
        static readonly NOTIFICATION_DISABLED = 28
        
        /** Notification received when the node is enabled again after being disabled. See [constant PROCESS_MODE_DISABLED]. */
        static readonly NOTIFICATION_ENABLED = 29
        
        /** Notification received when [method reset_physics_interpolation] is called on the node or its ancestors. */
        static readonly NOTIFICATION_RESET_PHYSICS_INTERPOLATION = 2001
        
        /** Notification received right before the scene with the node is saved in the editor. This notification is only sent in the Godot editor and will not occur in exported projects. */
        static readonly NOTIFICATION_EDITOR_PRE_SAVE = 9001
        
        /** Notification received right after the scene with the node is saved in the editor. This notification is only sent in the Godot editor and will not occur in exported projects. */
        static readonly NOTIFICATION_EDITOR_POST_SAVE = 9002
        
        /** Notification received when the mouse enters the window.  
         *  Implemented for embedded windows and on desktop and web platforms.  
         */
        static readonly NOTIFICATION_WM_MOUSE_ENTER = 1002
        
        /** Notification received when the mouse leaves the window.  
         *  Implemented for embedded windows and on desktop and web platforms.  
         */
        static readonly NOTIFICATION_WM_MOUSE_EXIT = 1003
        
        /** Notification received from the OS when the node's [Window] ancestor is focused. This may be a change of focus between two windows of the same engine instance, or from the OS desktop or a third-party application to a window of the game (in which case [constant NOTIFICATION_APPLICATION_FOCUS_IN] is also received).  
         *  A [Window] node receives this notification when it is focused.  
         */
        static readonly NOTIFICATION_WM_WINDOW_FOCUS_IN = 1004
        
        /** Notification received from the OS when the node's [Window] ancestor is defocused. This may be a change of focus between two windows of the same engine instance, or from a window of the game to the OS desktop or a third-party application (in which case [constant NOTIFICATION_APPLICATION_FOCUS_OUT] is also received).  
         *  A [Window] node receives this notification when it is defocused.  
         */
        static readonly NOTIFICATION_WM_WINDOW_FOCUS_OUT = 1005
        
        /** Notification received from the OS when a close request is sent (e.g. closing the window with a "Close" button or [kbd]Alt + F4[/kbd]).  
         *  Implemented on desktop platforms.  
         */
        static readonly NOTIFICATION_WM_CLOSE_REQUEST = 1006
        
        /** Notification received from the OS when a go back request is sent (e.g. pressing the "Back" button on Android).  
         *  Implemented only on Android.  
         */
        static readonly NOTIFICATION_WM_GO_BACK_REQUEST = 1007
        
        /** Notification received when the window is resized.  
         *      
         *  **Note:** Only the resized [Window] node receives this notification, and it's not propagated to the child nodes.  
         */
        static readonly NOTIFICATION_WM_SIZE_CHANGED = 1008
        
        /** Notification received from the OS when the screen's dots per inch (DPI) scale is changed. Only implemented on macOS. */
        static readonly NOTIFICATION_WM_DPI_CHANGE = 1009
        
        /** Notification received when the mouse cursor enters the [Viewport]'s visible area, that is not occluded behind other [Control]s or [Window]s, provided its [member Viewport.gui_disable_input] is `false` and regardless if it's currently focused or not. */
        static readonly NOTIFICATION_VP_MOUSE_ENTER = 1010
        
        /** Notification received when the mouse cursor leaves the [Viewport]'s visible area, that is not occluded behind other [Control]s or [Window]s, provided its [member Viewport.gui_disable_input] is `false` and regardless if it's currently focused or not. */
        static readonly NOTIFICATION_VP_MOUSE_EXIT = 1011
        
        /** Notification received when the window is moved. */
        static readonly NOTIFICATION_WM_POSITION_CHANGED = 1012
        
        /** Notification received from the OS when the application is exceeding its allocated memory.  
         *  Implemented only on iOS.  
         */
        static readonly NOTIFICATION_OS_MEMORY_WARNING = 2009
        
        /** Notification received when translations may have changed. Can be triggered by the user changing the locale, changing [member auto_translate_mode] or when the node enters the scene tree. Can be used to respond to language changes, for example to change the UI strings on the fly. Useful when working with the built-in translation support, like [method Object.tr].  
         *      
         *  **Note:** This notification is received alongside [constant NOTIFICATION_ENTER_TREE], so if you are instantiating a scene, the child nodes will not be initialized yet. You can use it to setup translations for this node, child nodes created from script, or if you want to access child nodes added in the editor, make sure the node is ready using [method is_node_ready].  
         *    
         */
        static readonly NOTIFICATION_TRANSLATION_CHANGED = 2010
        
        /** Notification received from the OS when a request for "About" information is sent.  
         *  Implemented only on macOS.  
         */
        static readonly NOTIFICATION_WM_ABOUT = 2011
        
        /** Notification received from Godot's crash handler when the engine is about to crash.  
         *  Implemented on desktop platforms, if the crash handler is enabled.  
         */
        static readonly NOTIFICATION_CRASH = 2012
        
        /** Notification received from the OS when an update of the Input Method Engine occurs (e.g. change of IME cursor position or composition string).  
         *  Implemented on desktop and web platforms.  
         */
        static readonly NOTIFICATION_OS_IME_UPDATE = 2013
        
        /** Notification received from the OS when the application is resumed.  
         *  Specific to the Android and iOS platforms.  
         */
        static readonly NOTIFICATION_APPLICATION_RESUMED = 2014
        
        /** Notification received from the OS when the application is paused.  
         *  Specific to the Android and iOS platforms.  
         *      
         *  **Note:** On iOS, you only have approximately 5 seconds to finish a task started by this signal. If you go over this allotment, iOS will kill the app instead of pausing it.  
         */
        static readonly NOTIFICATION_APPLICATION_PAUSED = 2015
        
        /** Notification received from the OS when the application is focused, i.e. when changing the focus from the OS desktop or a thirdparty application to any open window of the Godot instance.  
         *  Implemented on desktop and mobile platforms.  
         */
        static readonly NOTIFICATION_APPLICATION_FOCUS_IN = 2016
        
        /** Notification received from the OS when the application is defocused, i.e. when changing the focus from any open window of the Godot instance to the OS desktop or a thirdparty application.  
         *  Implemented on desktop and mobile platforms.  
         */
        static readonly NOTIFICATION_APPLICATION_FOCUS_OUT = 2017
        
        /** Notification received when the [TextServer] is changed. */
        static readonly NOTIFICATION_TEXT_SERVER_CHANGED = 2018
        
        /** Notification received when an accessibility information update is required. */
        static readonly NOTIFICATION_ACCESSIBILITY_UPDATE = 3000
        
        /** Notification received when accessibility elements are invalidated. All node accessibility elements are automatically deleted after receiving this message, therefore all existing references to such elements should be discarded. */
        static readonly NOTIFICATION_ACCESSIBILITY_INVALIDATE = 3001
        constructor(identifier?: any)
        
        /** Called on each idle frame, prior to rendering, and after physics ticks have been processed. [param delta] is the time between frames in seconds.  
         *  It is only called if processing is enabled for this Node, which is done automatically if this method is overridden, and can be toggled with [method set_process].  
         *  Processing happens in order of [member process_priority], lower priority values are called first. Nodes with the same priority are processed in tree order, or top to bottom as seen in the editor (also known as pre-order traversal).  
         *  Corresponds to the [constant NOTIFICATION_PROCESS] notification in [method Object._notification].  
         *      
         *  **Note:** This method is only called if the node is present in the scene tree (i.e. if it's not an orphan).  
         *      
         *  **Note:** When the engine is struggling and the frame rate is lowered, [param delta] will increase. When [param delta] is increased, it's capped at a maximum of [member Engine.time_scale] * [member Engine.max_physics_steps_per_frame] / [member Engine.physics_ticks_per_second]. As a result, accumulated [param delta] may not represent real world time.  
         *      
         *  **Note:** When `--fixed-fps` is enabled or the engine is running in Movie Maker mode (see [MovieWriter]), process [param delta] will always be the same for every frame, regardless of how much time the frame took to render.  
         *      
         *  **Note:** Frame delta may be post-processed by [member OS.delta_smoothing] if this is enabled for the project.  
         */
        /* gdvirtual */ _process(delta: float64): void
        
        /** Called once on each physics tick, and allows Nodes to synchronize their logic with physics ticks. [param delta] is the logical time between physics ticks in seconds and is equal to [member Engine.time_scale] / [member Engine.physics_ticks_per_second].  
         *  It is only called if physics processing is enabled for this Node, which is done automatically if this method is overridden, and can be toggled with [method set_physics_process].  
         *  Processing happens in order of [member process_physics_priority], lower priority values are called first. Nodes with the same priority are processed in tree order, or top to bottom as seen in the editor (also known as pre-order traversal).  
         *  Corresponds to the [constant NOTIFICATION_PHYSICS_PROCESS] notification in [method Object._notification].  
         *      
         *  **Note:** This method is only called if the node is present in the scene tree (i.e. if it's not an orphan).  
         *      
         *  **Note:** Accumulated [param delta] may diverge from real world seconds.  
         */
        /* gdvirtual */ _physics_process(delta: float64): void
        
        /** Called when the node enters the [SceneTree] (e.g. upon instantiating, scene changing, or after calling [method add_child] in a script). If the node has children, its [method _enter_tree] callback will be called first, and then that of the children.  
         *  Corresponds to the [constant NOTIFICATION_ENTER_TREE] notification in [method Object._notification].  
         */
        /* gdvirtual */ _enter_tree(): void
        
        /** Called when the node is about to leave the [SceneTree] (e.g. upon freeing, scene changing, or after calling [method remove_child] in a script). If the node has children, its [method _exit_tree] callback will be called last, after all its children have left the tree.  
         *  Corresponds to the [constant NOTIFICATION_EXIT_TREE] notification in [method Object._notification] and signal [signal tree_exiting]. To get notified when the node has already left the active tree, connect to the [signal tree_exited].  
         */
        /* gdvirtual */ _exit_tree(): void
        
        /** Called when the node is "ready", i.e. when both the node and its children have entered the scene tree. If the node has children, their [method _ready] callbacks get triggered first, and the parent node will receive the ready notification afterwards.  
         *  Corresponds to the [constant NOTIFICATION_READY] notification in [method Object._notification]. See also the `@onready` annotation for variables.  
         *  Usually used for initialization. For even earlier initialization, [method Object._init] may be used. See also [method _enter_tree].  
         *      
         *  **Note:** This method may be called only once for each node. After removing a node from the scene tree and adding it again, [method _ready] will **not** be called a second time. This can be bypassed by requesting another call with [method request_ready], which may be called anywhere before adding the node again.  
         */
        /* gdvirtual */ _ready(): void
        
        /** The elements in the array returned from this method are displayed as warnings in the Scene dock if the script that overrides it is a `tool` script.  
         *  Returning an empty array produces no warnings.  
         *  Call [method update_configuration_warnings] when the warnings need to be updated for this node.  
         *    
         */
        /* gdvirtual */ _get_configuration_warnings(): PackedStringArray
        
        /** The elements in the array returned from this method are displayed as warnings in the Scene dock if the script that overrides it is a `tool` script, and accessibility warnings are enabled in the editor settings.  
         *  Returning an empty array produces no warnings.  
         */
        /* gdvirtual */ _get_accessibility_configuration_warnings(): PackedStringArray
        
        /** Called when there is an input event. The input event propagates up through the node tree until a node consumes it.  
         *  It is only called if input processing is enabled, which is done automatically if this method is overridden, and can be toggled with [method set_process_input].  
         *  To consume the input event and stop it propagating further to other nodes, [method Viewport.set_input_as_handled] can be called.  
         *  For gameplay input, [method _unhandled_input] and [method _unhandled_key_input] are usually a better fit as they allow the GUI to intercept the events first.  
         *      
         *  **Note:** This method is only called if the node is present in the scene tree (i.e. if it's not an orphan).  
         */
        /* gdvirtual */ _input(event: InputEvent): void
        
        /** Called when an [InputEventKey], [InputEventShortcut], or [InputEventJoypadButton] hasn't been consumed by [method _input] or any GUI [Control] item. It is called before [method _unhandled_key_input] and [method _unhandled_input]. The input event propagates up through the node tree until a node consumes it.  
         *  It is only called if shortcut processing is enabled, which is done automatically if this method is overridden, and can be toggled with [method set_process_shortcut_input].  
         *  To consume the input event and stop it propagating further to other nodes, [method Viewport.set_input_as_handled] can be called.  
         *  This method can be used to handle shortcuts. For generic GUI events, use [method _input] instead. Gameplay events should usually be handled with either [method _unhandled_input] or [method _unhandled_key_input].  
         *      
         *  **Note:** This method is only called if the node is present in the scene tree (i.e. if it's not orphan).  
         */
        /* gdvirtual */ _shortcut_input(event: InputEvent): void
        
        /** Called when an [InputEvent] hasn't been consumed by [method _input] or any GUI [Control] item. It is called after [method _shortcut_input] and after [method _unhandled_key_input]. The input event propagates up through the node tree until a node consumes it.  
         *  It is only called if unhandled input processing is enabled, which is done automatically if this method is overridden, and can be toggled with [method set_process_unhandled_input].  
         *  To consume the input event and stop it propagating further to other nodes, [method Viewport.set_input_as_handled] can be called.  
         *  For gameplay input, this method is usually a better fit than [method _input], as GUI events need a higher priority. For keyboard shortcuts, consider using [method _shortcut_input] instead, as it is called before this method. Finally, to handle keyboard events, consider using [method _unhandled_key_input] for performance reasons.  
         *      
         *  **Note:** This method is only called if the node is present in the scene tree (i.e. if it's not an orphan).  
         */
        /* gdvirtual */ _unhandled_input(event: InputEvent): void
        
        /** Called when an [InputEventKey] hasn't been consumed by [method _input] or any GUI [Control] item. It is called after [method _shortcut_input] but before [method _unhandled_input]. The input event propagates up through the node tree until a node consumes it.  
         *  It is only called if unhandled key input processing is enabled, which is done automatically if this method is overridden, and can be toggled with [method set_process_unhandled_key_input].  
         *  To consume the input event and stop it propagating further to other nodes, [method Viewport.set_input_as_handled] can be called.  
         *  This method can be used to handle Unicode character input with [kbd]Alt[/kbd], [kbd]Alt + Ctrl[/kbd], and [kbd]Alt + Shift[/kbd] modifiers, after shortcuts were handled.  
         *  For gameplay input, this and [method _unhandled_input] are usually a better fit than [method _input], as GUI events should be handled first. This method also performs better than [method _unhandled_input], since unrelated events such as [InputEventMouseMotion] are automatically filtered. For shortcuts, consider using [method _shortcut_input] instead.  
         *      
         *  **Note:** This method is only called if the node is present in the scene tree (i.e. if it's not an orphan).  
         */
        /* gdvirtual */ _unhandled_key_input(event: InputEvent): void
        
        /** Called during accessibility information updates to determine the currently focused sub-element, should return a sub-element RID or the value returned by [method get_accessibility_element]. */
        /* gdvirtual */ _get_focused_accessibility_element(): RID
        
        /** Prints all orphan nodes (nodes outside the [SceneTree]). Useful for debugging.  
         *      
         *  **Note:** This method only works in debug builds. It does nothing in a project exported in release mode.  
         */
        static print_orphan_nodes(): void
        
        /** Returns object IDs of all orphan nodes (nodes outside the [SceneTree]). Used for debugging.  
         *      
         *  **Note:** [method get_orphan_node_ids] only works in debug builds. When called in a project exported in release mode, [method get_orphan_node_ids] will return an empty array.  
         */
        static get_orphan_node_ids(): GArray<int64>
        
        /** Adds a [param sibling] node to this node's parent, and moves the added sibling right below this node.  
         *  If [param force_readable_name] is `true`, improves the readability of the added [param sibling]. If not named, the [param sibling] is renamed to its type, and if it shares [member name] with a sibling, a number is suffixed more appropriately. This operation is very slow. As such, it is recommended leaving this to `false`, which assigns a dummy name featuring `@` in both situations.  
         *  Use [method add_child] instead of this method if you don't need the child node to be added below a specific node in the list of children.  
         *      
         *  **Note:** If this node is internal, the added sibling will be internal too (see [method add_child]'s `internal` parameter).  
         */
        add_sibling(sibling: Node, force_readable_name?: boolean /* = false */): void
        set_name(name: StringName): void
        get_name(): StringName
        
        /** Adds a child [param node]. Nodes can have any number of children, but every child must have a unique name. Child nodes are automatically deleted when the parent node is deleted, so an entire scene can be removed by deleting its topmost node.  
         *  If [param force_readable_name] is `true`, improves the readability of the added [param node]. If not named, the [param node] is renamed to its type, and if it shares [member name] with a sibling, a number is suffixed more appropriately. This operation is very slow. As such, it is recommended leaving this to `false`, which assigns a dummy name featuring `@` in both situations.  
         *  If [param internal] is different than [constant INTERNAL_MODE_DISABLED], the child will be added as internal node. These nodes are ignored by methods like [method get_children], unless their parameter `include_internal` is `true`. It also prevents these nodes being duplicated with their parent. The intended usage is to hide the internal nodes from the user, so the user won't accidentally delete or modify them. Used by some GUI nodes, e.g. [ColorPicker].  
         *      
         *  **Note:** If [param node] already has a parent, this method will fail. Use [method remove_child] first to remove [param node] from its current parent. For example:  
         *    
         *  If you need the child node to be added below a specific node in the list of children, use [method add_sibling] instead of this method.  
         *      
         *  **Note:** If you want a child to be persisted to a [PackedScene], you must set [member owner] in addition to calling [method add_child]. This is typically relevant for [url=https://docs.godotengine.org/en/4.6/tutorials/plugins/running_code_in_the_editor.html]tool scripts[/url] and [url=https://docs.godotengine.org/en/4.6/tutorials/plugins/editor/index.html]editor plugins[/url]. If [method add_child] is called without setting [member owner], the newly added [Node] will not be visible in the scene tree, though it will be visible in the 2D/3D view.  
         */
        add_child(node: NodePathMapChild<Map>, force_readable_name?: boolean /* = false */, internal?: Node.InternalMode /* = 0 */): void
        
        /** Removes a child [param node]. The [param node], along with its children, are **not** deleted. To delete a node, see [method queue_free].  
         *      
         *  **Note:** When this node is inside the tree, this method sets the [member owner] of the removed [param node] (or its descendants) to `null`, if their [member owner] is no longer an ancestor (see [method is_ancestor_of]).  
         */
        remove_child(node: NodePathMapChild<Map>): void
        
        /** Changes the parent of this [Node] to the [param new_parent]. The node needs to already have a parent. The node's [member owner] is preserved if its owner is still reachable from the new location (i.e., the node is still a descendant of the new parent after the operation).  
         *  If [param keep_global_transform] is `true`, the node's global transform will be preserved if supported. [Node2D], [Node3D] and [Control] support this argument (but [Control] keeps only position).  
         */
        reparent(new_parent: Node, keep_global_transform?: boolean /* = true */): void
        
        /** Returns the number of children of this node.  
         *  If [param include_internal] is `false`, internal children are not counted (see [method add_child]'s `internal` parameter).  
         */
        get_child_count(include_internal?: boolean /* = false */): int64
        
        /** Returns all children of this node inside an [Array].  
         *  If [param include_internal] is `false`, excludes internal children from the returned array (see [method add_child]'s `internal` parameter).  
         */
        get_children(include_internal?: boolean /* = false */): GArray<NodePathMapChild<Map>>
        
        /** Fetches a child node by its index. Each child node has an index relative to its siblings (see [method get_index]). The first child is at index 0. Negative values can also be used to start from the end of the list. This method can be used in combination with [method get_child_count] to iterate over this node's children. If no child exists at the given index, this method returns `null` and an error is generated.  
         *  If [param include_internal] is `false`, internal children are ignored (see [method add_child]'s `internal` parameter).  
         *    
         *      
         *  **Note:** To fetch a node by [NodePath], use [method get_node].  
         */
        get_child(idx: int64, include_internal?: boolean /* = false */): NodePathMapChild<Map>
        
        /** Returns `true` if the [param path] points to a valid node. See also [method get_node]. */
        has_node(path: NodePath | string): boolean
        
        /** Fetches a node. The [NodePath] can either be a relative path (from this node), or an absolute path (from the [member SceneTree.root]) to a node. If [param path] does not point to a valid node, generates an error and returns `null`. Attempts to access methods on the return value will result in an  *"Attempt to call <method> on a null instance."*  error.  
         *      
         *  **Note:** Fetching by absolute path only works when the node is inside the scene tree (see [method is_inside_tree]).  
         *  **Example:** Assume this method is called from the Character node, inside the following tree:  
         *  [codeblock lang=text]  
         *   ┖╴root  
         *      ┠╴Character (you are here!)  
         *      ┃  ┠╴Sword  
         *      ┃  ┖╴Backpack  
         *      ┃     ┖╴Dagger  
         *      ┠╴MyGame  
         *      ┖╴Swamp  
         *         ┠╴Alligator  
         *         ┠╴Mosquito  
         *         ┖╴Goblin  
         *  [/codeblock]  
         *  The following calls will return a valid node:  
         *    
         */
        get_node<Path extends StaticNodePath<Map>, Default = never>(path: Path): ResolveNodePath<Map, Path, Default>
        
        /** Fetches a node by [NodePath]. Similar to [method get_node], but does not generate an error if [param path] does not point to a valid node. */
        get_node_or_null<Path extends StaticNodePath<Map, undefined | Node>, Default = null>(path: Path): null | ResolveNodePath<Map, Path, Default, undefined | Node>
        get_node_or_null(path: NodePath | string): null | Node
        
        /** Returns this node's parent node, or `null` if the node doesn't have a parent. */
        get_parent(): null | Node
        
        /** Finds the first descendant of this node whose [member name] matches [param pattern], returning `null` if no match is found. The matching is done against node names,  *not*  their paths, through [method String.match]. As such, it is case-sensitive, `"*"` matches zero or more characters, and `"?"` matches any single character.  
         *  If [param recursive] is `false`, only this node's direct children are checked. Nodes are checked in tree order, so this node's first direct child is checked first, then its own direct children, etc., before moving to the second direct child, and so on. Internal children are also included in the search (see `internal` parameter in [method add_child]).  
         *  If [param owned] is `true`, only descendants with a valid [member owner] node are checked.  
         *      
         *  **Note:** This method can be very slow. Consider storing a reference to the found node in a variable. Alternatively, use [method get_node] with unique names (see [member unique_name_in_owner]).  
         *      
         *  **Note:** To find all descendant nodes matching a pattern or a class type, see [method find_children].  
         */
        find_child(pattern: string, recursive?: boolean /* = true */, owned?: boolean /* = true */): null | Node
        
        /** Finds all descendants of this node whose names match [param pattern], returning an empty [Array] if no match is found. The matching is done against node names,  *not*  their paths, through [method String.match]. As such, it is case-sensitive, `"*"` matches zero or more characters, and `"?"` matches any single character.  
         *  If [param type] is not empty, only ancestors inheriting from [param type] are included (see [method Object.is_class]).  
         *  If [param recursive] is `false`, only this node's direct children are checked. Nodes are checked in tree order, so this node's first direct child is checked first, then its own direct children, etc., before moving to the second direct child, and so on. Internal children are also included in the search (see `internal` parameter in [method add_child]).  
         *  If [param owned] is `true`, only descendants with a valid [member owner] node are checked.  
         *      
         *  **Note:** This method can be very slow. Consider storing references to the found nodes in a variable.  
         *      
         *  **Note:** To find a single descendant node matching a pattern, see [method find_child].  
         */
        find_children(pattern: string, type?: string /* = '' */, recursive?: boolean /* = true */, owned?: boolean /* = true */): GArray<Node>
        
        /** Finds the first ancestor of this node whose [member name] matches [param pattern], returning `null` if no match is found. The matching is done through [method String.match]. As such, it is case-sensitive, `"*"` matches zero or more characters, and `"?"` matches any single character. See also [method find_child] and [method find_children].  
         *      
         *  **Note:** As this method walks upwards in the scene tree, it can be slow in large, deeply nested nodes. Consider storing a reference to the found node in a variable. Alternatively, use [method get_node] with unique names (see [member unique_name_in_owner]).  
         */
        find_parent(pattern: string): null | Node
        
        /** Returns `true` if [param path] points to a valid node and its subnames point to a valid [Resource], e.g. `Area2D/CollisionShape2D:shape`. Properties that are not [Resource] types (such as nodes or other [Variant] types) are not considered. See also [method get_node_and_resource]. */
        has_node_and_resource(path: NodePath | string): boolean
        
        /** Fetches a node and its most nested resource as specified by the [NodePath]'s subname. Returns an [Array] of size `3` where:  
         *  - Element `0` is the [Node], or `null` if not found;  
         *  - Element `1` is the subname's last nested [Resource], or `null` if not found;  
         *  - Element `2` is the remaining [NodePath], referring to an existing, non-[Resource] property (see [method Object.get_indexed]).  
         *  **Example:** Assume that the child's [member Sprite2D.texture] has been assigned an [AtlasTexture]:  
         *    
         */
        get_node_and_resource(path: NodePath | string): GArray
        
        /** Returns `true` if this node is currently inside a [SceneTree]. See also [method get_tree]. */
        is_inside_tree(): boolean
        
        /** Returns `true` if the node is part of the scene currently opened in the editor. */
        is_part_of_edited_scene(): boolean
        
        /** Returns `true` if the given [param node] is a direct or indirect child of this node. */
        is_ancestor_of(node: Node): boolean
        
        /** Returns `true` if the given [param node] occurs later in the scene hierarchy than this node. A node occurring later is usually processed last. */
        is_greater_than(node: Node): boolean
        
        /** Returns the node's absolute path, relative to the [member SceneTree.root]. If the node is not inside the scene tree, this method fails and returns an empty [NodePath]. */
        get_path(): NodePath
        
        /** Returns the relative [NodePath] from this node to the specified [param node]. Both nodes must be in the same [SceneTree] or scene hierarchy, otherwise this method fails and returns an empty [NodePath].  
         *  If [param use_unique_path] is `true`, returns the shortest path accounting for this node's unique name (see [member unique_name_in_owner]).  
         *      
         *  **Note:** If you get a relative path which starts from a unique node, the path may be longer than a normal relative path, due to the addition of the unique node's name.  
         */
        get_path_to(node: Node, use_unique_path?: boolean /* = false */): NodePath
        
        /** Adds the node to the [param group]. Groups can be helpful to organize a subset of nodes, for example `"enemies"` or `"collectables"`. See notes in the description, and the group methods in [SceneTree].  
         *  If [param persistent] is `true`, the group will be stored when saved inside a [PackedScene]. All groups created and displayed in the Groups dock are persistent.  
         *      
         *  **Note:** To improve performance, the order of group names is  *not*  guaranteed and may vary between project runs. Therefore, do not rely on the group order.  
         *      
         *  **Note:** [SceneTree]'s group methods will  *not*  work on this node if not inside the tree (see [method is_inside_tree]).  
         */
        add_to_group(group: StringName, persistent?: boolean /* = false */): void
        
        /** Removes the node from the given [param group]. Does nothing if the node is not in the [param group]. See also notes in the description, and the [SceneTree]'s group methods. */
        remove_from_group(group: StringName): void
        
        /** Returns `true` if this node has been added to the given [param group]. See [method add_to_group] and [method remove_from_group]. See also notes in the description, and the [SceneTree]'s group methods. */
        is_in_group(group: StringName): boolean
        
        /** Moves [param child_node] to the given index. A node's index is the order among its siblings. If [param to_index] is negative, the index is counted from the end of the list. See also [method get_child] and [method get_index].  
         *      
         *  **Note:** The processing order of several engine callbacks ([method _ready], [method _process], etc.) and notifications sent through [method propagate_notification] is affected by tree order. [CanvasItem] nodes are also rendered in tree order. See also [member process_priority].  
         */
        move_child(child_node: NodePathMapChild<Map>, to_index: int64): void
        
        /** Returns an [Array] of group names that the node has been added to.  
         *      
         *  **Note:** To improve performance, the order of group names is  *not*  guaranteed and may vary between project runs. Therefore, do not rely on the group order.  
         *      
         *  **Note:** This method may also return some group names starting with an underscore (`_`). These are internally used by the engine. To avoid conflicts, do not use custom groups starting with underscores. To exclude internal groups, see the following code snippet:  
         *    
         */
        get_groups(): GArray<StringName>
        
        /** Returns this node's order among its siblings. The first node's index is `0`. See also [method get_child].  
         *  If [param include_internal] is `false`, returns the index ignoring internal children. The first, non-internal child will have an index of `0` (see [method add_child]'s `internal` parameter).  
         */
        get_index(include_internal?: boolean /* = false */): int64
        
        /** Prints the node and its children to the console, recursively. The node does not have to be inside the tree. This method outputs [NodePath]s relative to this node, and is good for copy/pasting into [method get_node]. See also [method print_tree_pretty].  
         *  May print, for example:  
         *  [codeblock lang=text]  
         *  .  
         *  Menu  
         *  Menu/Label  
         *  Menu/Camera2D  
         *  SplashScreen  
         *  SplashScreen/Camera2D  
         *  [/codeblock]  
         */
        print_tree(): void
        
        /** Prints the node and its children to the console, recursively. The node does not have to be inside the tree. Similar to [method print_tree], but the graphical representation looks like what is displayed in the editor's Scene dock. It is useful for inspecting larger trees.  
         *  May print, for example:  
         *  [codeblock lang=text]  
         *   ┖╴TheGame  
         *      ┠╴Menu  
         *      ┃  ┠╴Label  
         *      ┃  ┖╴Camera2D  
         *      ┖╴SplashScreen  
         *         ┖╴Camera2D  
         *  [/codeblock]  
         */
        print_tree_pretty(): void
        
        /** Returns the tree as a [String]. Used mainly for debugging purposes. This version displays the path relative to the current node, and is good for copy/pasting into the [method get_node] function. It also can be used in game UI/UX.  
         *  May print, for example:  
         *  [codeblock lang=text]  
         *  TheGame  
         *  TheGame/Menu  
         *  TheGame/Menu/Label  
         *  TheGame/Menu/Camera2D  
         *  TheGame/SplashScreen  
         *  TheGame/SplashScreen/Camera2D  
         *  [/codeblock]  
         */
        get_tree_string(): string
        
        /** Similar to [method get_tree_string], this returns the tree as a [String]. This version displays a more graphical representation similar to what is displayed in the Scene Dock. It is useful for inspecting larger trees.  
         *  May print, for example:  
         *  [codeblock lang=text]  
         *   ┖╴TheGame  
         *      ┠╴Menu  
         *      ┃  ┠╴Label  
         *      ┃  ┖╴Camera2D  
         *      ┖╴SplashScreen  
         *         ┖╴Camera2D  
         *  [/codeblock]  
         */
        get_tree_string_pretty(): string
        
        /** Calls [method Object.notification] with [param what] on this node and all of its children, recursively. */
        propagate_notification(what: int64): void
        
        /** Calls the given [param method] name, passing [param args] as arguments, on this node and all of its children, recursively.  
         *  If [param parent_first] is `true`, the method is called on this node first, then on all of its children. If `false`, the children's methods are called first.  
         */
        propagate_call(method: StringName, args?: GArray, parent_first?: boolean /* = false */): void
        
        /** If set to `true`, enables physics (fixed framerate) processing. When a node is being processed, it will receive a [constant NOTIFICATION_PHYSICS_PROCESS] at a fixed (usually 60 FPS, see [member Engine.physics_ticks_per_second] to change) interval (and the [method _physics_process] callback will be called if it exists).  
         *      
         *  **Note:** If [method _physics_process] is overridden, this will be automatically enabled before [method _ready] is called.  
         */
        set_physics_process(enable: boolean): void
        
        /** Returns the time elapsed (in seconds) since the last physics callback. This value is identical to [method _physics_process]'s `delta` parameter, and is often consistent at run-time, unless [member Engine.physics_ticks_per_second] is changed. See also [constant NOTIFICATION_PHYSICS_PROCESS].  
         *      
         *  **Note:** The returned value will be larger than expected if running at a framerate lower than [member Engine.physics_ticks_per_second] / [member Engine.max_physics_steps_per_frame] FPS. This is done to avoid "spiral of death" scenarios where performance would plummet due to an ever-increasing number of physics steps per frame. This behavior affects both [method _process] and [method _physics_process]. As a result, avoid using `delta` for time measurements in real-world seconds. Use the [Time] singleton's methods for this purpose instead, such as [method Time.get_ticks_usec].  
         */
        get_physics_process_delta_time(): float64
        
        /** Returns `true` if physics processing is enabled (see [method set_physics_process]). */
        is_physics_processing(): boolean
        
        /** Returns the time elapsed (in seconds) since the last process callback. This value is identical to [method _process]'s `delta` parameter, and may vary from frame to frame. See also [constant NOTIFICATION_PROCESS].  
         *      
         *  **Note:** The returned value will be larger than expected if running at a framerate lower than [member Engine.physics_ticks_per_second] / [member Engine.max_physics_steps_per_frame] FPS. This is done to avoid "spiral of death" scenarios where performance would plummet due to an ever-increasing number of physics steps per frame. This behavior affects both [method _process] and [method _physics_process]. As a result, avoid using `delta` for time measurements in real-world seconds. Use the [Time] singleton's methods for this purpose instead, such as [method Time.get_ticks_usec].  
         */
        get_process_delta_time(): float64
        
        /** If set to `true`, enables processing. When a node is being processed, it will receive a [constant NOTIFICATION_PROCESS] on every drawn frame (and the [method _process] callback will be called if it exists).  
         *      
         *  **Note:** If [method _process] is overridden, this will be automatically enabled before [method _ready] is called.  
         *      
         *  **Note:** This method only affects the [method _process] callback, i.e. it has no effect on other callbacks like [method _physics_process]. If you want to disable all processing for the node, set [member process_mode] to [constant PROCESS_MODE_DISABLED].  
         */
        set_process(enable: boolean): void
        
        /** Returns `true` if processing is enabled (see [method set_process]). */
        is_processing(): boolean
        
        /** If set to `true`, enables input processing.  
         *      
         *  **Note:** If [method _input] is overridden, this will be automatically enabled before [method _ready] is called. Input processing is also already enabled for GUI controls, such as [Button] and [TextEdit].  
         */
        set_process_input(enable: boolean): void
        
        /** Returns `true` if the node is processing input (see [method set_process_input]). */
        is_processing_input(): boolean
        
        /** If set to `true`, enables shortcut processing for this node.  
         *      
         *  **Note:** If [method _shortcut_input] is overridden, this will be automatically enabled before [method _ready] is called.  
         */
        set_process_shortcut_input(enable: boolean): void
        
        /** Returns `true` if the node is processing shortcuts (see [method set_process_shortcut_input]). */
        is_processing_shortcut_input(): boolean
        
        /** If set to `true`, enables unhandled input processing. It enables the node to receive all input that was not previously handled (usually by a [Control]).  
         *      
         *  **Note:** If [method _unhandled_input] is overridden, this will be automatically enabled before [method _ready] is called. Unhandled input processing is also already enabled for GUI controls, such as [Button] and [TextEdit].  
         */
        set_process_unhandled_input(enable: boolean): void
        
        /** Returns `true` if the node is processing unhandled input (see [method set_process_unhandled_input]). */
        is_processing_unhandled_input(): boolean
        
        /** If set to `true`, enables unhandled key input processing.  
         *      
         *  **Note:** If [method _unhandled_key_input] is overridden, this will be automatically enabled before [method _ready] is called.  
         */
        set_process_unhandled_key_input(enable: boolean): void
        
        /** Returns `true` if the node is processing unhandled key input (see [method set_process_unhandled_key_input]). */
        is_processing_unhandled_key_input(): boolean
        
        /** Returns `true` if the node can receive processing notifications and input callbacks ([constant NOTIFICATION_PROCESS], [method _input], etc.) from the [SceneTree] and [Viewport]. The returned value depends on [member process_mode]:  
         *  - If set to [constant PROCESS_MODE_PAUSABLE], returns `true` when the game is processing, i.e. [member SceneTree.paused] is `false`;  
         *  - If set to [constant PROCESS_MODE_WHEN_PAUSED], returns `true` when the game is paused, i.e. [member SceneTree.paused] is `true`;  
         *  - If set to [constant PROCESS_MODE_ALWAYS], always returns `true`;  
         *  - If set to [constant PROCESS_MODE_DISABLED], always returns `false`;  
         *  - If set to [constant PROCESS_MODE_INHERIT], use the parent node's [member process_mode] to determine the result.  
         *  If the node is not inside the tree, returns `false` no matter the value of [member process_mode].  
         */
        can_process(): boolean
        
        /** Queues an accessibility information update for this node. */
        queue_accessibility_update(): void
        
        /** Returns main accessibility element RID.  
         *      
         *  **Note:** This method should be called only during accessibility information updates ([constant NOTIFICATION_ACCESSIBILITY_UPDATE]).  
         */
        get_accessibility_element(): RID
        
        /** If set to `true`, the node appears folded in the Scene dock. As a result, all of its children are hidden. This method is intended to be used in editor plugins and tools, but it also works in release builds. See also [method is_displayed_folded]. */
        set_display_folded(fold: boolean): void
        
        /** Returns `true` if the node is folded (collapsed) in the Scene dock. This method is intended to be used in editor plugins and tools. See also [method set_display_folded]. */
        is_displayed_folded(): boolean
        
        /** If set to `true`, enables internal processing for this node. Internal processing happens in isolation from the normal [method _process] calls and is used by some nodes internally to guarantee proper functioning even if the node is paused or processing is disabled for scripting ([method set_process]).  
         *  **Warning:** Built-in nodes rely on internal processing for their internal logic. Disabling it is unsafe and may lead to unexpected behavior. Use this method if you know what you are doing.  
         */
        set_process_internal(enable: boolean): void
        
        /** Returns `true` if internal processing is enabled (see [method set_process_internal]). */
        is_processing_internal(): boolean
        
        /** If set to `true`, enables internal physics for this node. Internal physics processing happens in isolation from the normal [method _physics_process] calls and is used by some nodes internally to guarantee proper functioning even if the node is paused or physics processing is disabled for scripting ([method set_physics_process]).  
         *  **Warning:** Built-in nodes rely on internal processing for their internal logic. Disabling it is unsafe and may lead to unexpected behavior. Use this method if you know what you are doing.  
         */
        set_physics_process_internal(enable: boolean): void
        
        /** Returns `true` if internal physics processing is enabled (see [method set_physics_process_internal]). */
        is_physics_processing_internal(): boolean
        
        /** Returns `true` if physics interpolation is enabled for this node (see [member physics_interpolation_mode]).  
         *      
         *  **Note:** Interpolation will only be active if both the flag is set **and** physics interpolation is enabled within the [SceneTree]. This can be tested using [method is_physics_interpolated_and_enabled].  
         */
        is_physics_interpolated(): boolean
        
        /** Returns `true` if physics interpolation is enabled (see [member physics_interpolation_mode]) **and** enabled in the [SceneTree].  
         *  This is a convenience version of [method is_physics_interpolated] that also checks whether physics interpolation is enabled globally.  
         *  See [member SceneTree.physics_interpolation] and [member ProjectSettings.physics/common/physics_interpolation].  
         */
        is_physics_interpolated_and_enabled(): boolean
        
        /** When physics interpolation is active, moving a node to a radically different transform (such as placement within a level) can result in a visible glitch as the object is rendered moving from the old to new position over the physics tick.  
         *  That glitch can be prevented by calling this method, which temporarily disables interpolation until the physics tick is complete.  
         *  The notification [constant NOTIFICATION_RESET_PHYSICS_INTERPOLATION] will be received by the node and all children recursively.  
         *      
         *  **Note:** This function should be called **after** moving the node, rather than before.  
         */
        reset_physics_interpolation(): void
        
        /** Returns `true` if this node can automatically translate messages depending on the current locale. See [member auto_translate_mode], [method atr], and [method atr_n]. */
        can_auto_translate(): boolean
        
        /** Makes this node inherit the translation domain from its parent node. If this node has no parent, the main translation domain will be used.  
         *  This is the default behavior for all nodes. Calling [method Object.set_translation_domain] disables this behavior.  
         */
        set_translation_domain_inherited(): void
        
        /** Returns the [Window] that contains this node. If the node is in the main window, this is equivalent to getting the root node (`get_tree().get_root()`). */
        get_window(): null | Window
        
        /** Returns the [Window] that contains this node, or the last exclusive child in a chain of windows starting with the one that contains this node. */
        get_last_exclusive_window(): null | Window
        
        /** Returns the [SceneTree] that contains this node. If this node is not inside the tree, generates an error and returns `null`. See also [method is_inside_tree]. */
        get_tree(): SceneTree
        
        /** Creates a new [Tween] and binds it to this node.  
         *  This is the equivalent of doing:  
         *    
         *  The Tween will start automatically on the next process frame or physics frame (depending on [enum Tween.TweenProcessMode]). See [method Tween.bind_node] for more info on Tweens bound to nodes.  
         *      
         *  **Note:** The method can still be used when the node is not inside [SceneTree]. It can fail in an unlikely case of using a custom [MainLoop].  
         */
        create_tween(): Tween
        
        /** Duplicates the node, returning a new node with all of its properties, signals, groups, and children copied from the original, recursively. The behavior can be tweaked through the [param flags] (see [enum DuplicateFlags]). Internal nodes are not duplicated.  
         *      
         *  **Note:** For nodes with a [Script] attached, if [method Object._init] has been defined with required parameters, the duplicated node will not have a [Script].  
         *      
         *  **Note:** By default, this method will duplicate only properties marked for serialization (i.e. using [constant @GlobalScope.PROPERTY_USAGE_STORAGE], or in GDScript, [annotation @GDScript.@export]). If you want to duplicate all properties, use [constant DUPLICATE_INTERNAL_STATE].  
         */
        duplicate(flags?: int64 /* = 15 */): null | Node
        
        /** Replaces this node by the given [param node]. All children of this node are moved to [param node].  
         *  If [param keep_groups] is `true`, the [param node] is added to the same groups that the replaced node is in (see [method add_to_group]).  
         *  **Warning:** The replaced node is removed from the tree, but it is **not** deleted. To prevent memory leaks, store a reference to the node in a variable, or use [method Object.free].  
         */
        replace_by(node: Node, keep_groups?: boolean /* = false */): void
        
        /** If set to `true`, the node becomes an [InstancePlaceholder] when packed and instantiated from a [PackedScene]. See also [method get_scene_instance_load_placeholder]. */
        set_scene_instance_load_placeholder(load_placeholder: boolean): void
        
        /** Returns `true` if this node is an instance load placeholder. See [InstancePlaceholder] and [method set_scene_instance_load_placeholder]. */
        get_scene_instance_load_placeholder(): boolean
        
        /** Set to `true` to allow all nodes owned by [param node] to be available, and editable, in the Scene dock, even if their [member owner] is not the scene root. This method is intended to be used in editor plugins and tools, but it also works in release builds. See also [method is_editable_instance]. */
        set_editable_instance(node: Node, is_editable: boolean): void
        
        /** Returns `true` if [param node] has editable children enabled relative to this node. This method is intended to be used in editor plugins and tools. See also [method set_editable_instance]. */
        is_editable_instance(node: Node): boolean
        
        /** Returns the node's closest [Viewport] ancestor, if the node is inside the tree. Otherwise, returns `null`. */
        get_viewport(): null | Viewport
        
        /** Queues this node to be deleted at the end of the current frame. When deleted, all of its children are deleted as well, and all references to the node and its children become invalid.  
         *  Unlike with [method Object.free], the node is not deleted instantly, and it can still be accessed before deletion. It is also safe to call [method queue_free] multiple times. Use [method Object.is_queued_for_deletion] to check if the node will be deleted at the end of the frame.  
         *      
         *  **Note:** The node will only be freed after all other deferred calls are finished. Using this method is not always the same as calling [method Object.free] through [method Object.call_deferred].  
         */
        queue_free(): void
        
        /** Requests [method _ready] to be called again the next time the node enters the tree. Does **not** immediately call [method _ready].  
         *      
         *  **Note:** This method only affects the current node. If the node's children also need to request ready, this method needs to be called for each one of them. When the node and its children enter the tree again, the order of [method _ready] callbacks will be the same as normal.  
         */
        request_ready(): void
        
        /** Returns `true` if the node is ready, i.e. it's inside scene tree and all its children are initialized.  
         *  [method request_ready] resets it back to `false`.  
         */
        is_node_ready(): boolean
        
        /** Sets the node's multiplayer authority to the peer with the given peer [param id]. The multiplayer authority is the peer that has authority over the node on the network. Defaults to peer ID 1 (the server). Useful in conjunction with [method rpc_config] and the [MultiplayerAPI].  
         *  If [param recursive] is `true`, the given peer is recursively set as the authority for all children of this node.  
         *  **Warning:** This does **not** automatically replicate the new authority to other peers. It is the developer's responsibility to do so. You may replicate the new authority's information using [member MultiplayerSpawner.spawn_function], an RPC, or a [MultiplayerSynchronizer]. Furthermore, the parent's authority does **not** propagate to newly added children.  
         */
        set_multiplayer_authority(id: int64, recursive?: boolean /* = true */): void
        
        /** Returns the peer ID of the multiplayer authority for this node. See [method set_multiplayer_authority]. */
        get_multiplayer_authority(): int64
        
        /** Returns `true` if the local system is the multiplayer authority of this node. */
        is_multiplayer_authority(): boolean
        
        /** Changes the RPC configuration for the given [param method]. [param config] should either be `null` to disable the feature (as by default), or a [Dictionary] containing the following entries:  
         *  - `rpc_mode`: see [enum MultiplayerAPI.RPCMode];  
         *  - `transfer_mode`: see [enum MultiplayerPeer.TransferMode];  
         *  - `call_local`: if `true`, the method will also be called locally;  
         *  - `channel`: an [int] representing the channel to send the RPC on.  
         *      
         *  **Note:** In GDScript, this method corresponds to the [annotation @GDScript.@rpc] annotation, with various parameters passed (`@rpc(any)`, `@rpc(authority)`...). See also the [url=https://docs.godotengine.org/en/4.6/tutorials/networking/high_level_multiplayer.html]high-level multiplayer[/url] tutorial.  
         */
        rpc_config(method: StringName, config: any): void
        
        /** Returns a [Dictionary] mapping method names to their RPC configuration defined for this node using [method rpc_config].  
         *      
         *  **Note:** This method only returns the RPC configuration assigned via [method rpc_config]. See [method Script.get_rpc_config] to retrieve the RPCs defined by the [Script].  
         */
        get_node_rpc_config(): any
        
        /** Translates a [param message], using the translation catalogs configured in the Project Settings. Further [param context] can be specified to help with the translation. Note that most [Control] nodes automatically translate their strings, so this method is mostly useful for formatted strings or custom drawn text.  
         *  This method works the same as [method Object.tr], with the addition of respecting the [member auto_translate_mode] state.  
         *  If [method Object.can_translate_messages] is `false`, or no translation is available, this method returns the [param message] without changes. See [method Object.set_message_translation].  
         *  For detailed examples, see [url=https://docs.godotengine.org/en/4.6/tutorials/i18n/internationalizing_games.html]Internationalizing games[/url].  
         */
        atr(message: string, context?: StringName /* = '' */): string
        
        /** Translates a [param message] or [param plural_message], using the translation catalogs configured in the Project Settings. Further [param context] can be specified to help with the translation.  
         *  This method works the same as [method Object.tr_n], with the addition of respecting the [member auto_translate_mode] state.  
         *  If [method Object.can_translate_messages] is `false`, or no translation is available, this method returns [param message] or [param plural_message], without changes. See [method Object.set_message_translation].  
         *  The [param n] is the number, or amount, of the message's subject. It is used by the translation system to fetch the correct plural form for the current language.  
         *  For detailed examples, see [url=https://docs.godotengine.org/en/4.6/tutorials/i18n/localization_using_gettext.html]Localization using gettext[/url].  
         *      
         *  **Note:** Negative and [float] numbers may not properly apply to some countable subjects. It's recommended to handle these cases with [method atr].  
         */
        atr_n(message: string, plural_message: StringName, n: int64, context?: StringName /* = '' */): string
        _set_property_pinned(property: string, pinned: boolean): void
        
        /** Sends a remote procedure call request for the given [param method] to peers on the network (and locally), sending additional arguments to the method called by the RPC. The call request will only be received by nodes with the same [NodePath], including the exact same [member name]. Behavior depends on the RPC configuration for the given [param method] (see [method rpc_config] and [annotation @GDScript.@rpc]). By default, methods are not exposed to RPCs.  
         *  May return [constant OK] if the call is successful, [constant ERR_INVALID_PARAMETER] if the arguments passed in the [param method] do not match, [constant ERR_UNCONFIGURED] if the node's [member multiplayer] cannot be fetched (such as when the node is not inside the tree), [constant ERR_CONNECTION_ERROR] if [member multiplayer]'s connection is not available.  
         *      
         *  **Note:** You can only safely use RPCs on clients after you received the [signal MultiplayerAPI.connected_to_server] signal from the [MultiplayerAPI]. You also need to keep track of the connection state, either by the [MultiplayerAPI] signals like [signal MultiplayerAPI.server_disconnected] or by checking (`get_multiplayer().peer.get_connection_status() == CONNECTION_CONNECTED`).  
         */
        rpc(method: StringName, ...varargs: any[]): Error
        
        /** Sends a [method rpc] to a specific peer identified by [param peer_id] (see [method MultiplayerPeer.set_target_peer]).  
         *  May return [constant OK] if the call is successful, [constant ERR_INVALID_PARAMETER] if the arguments passed in the [param method] do not match, [constant ERR_UNCONFIGURED] if the node's [member multiplayer] cannot be fetched (such as when the node is not inside the tree), [constant ERR_CONNECTION_ERROR] if [member multiplayer]'s connection is not available.  
         */
        rpc_id(peer_id: int64, method: StringName, ...varargs: any[]): Error
        
        /** Refreshes the warnings displayed for this node in the Scene dock. Use [method _get_configuration_warnings] to customize the warning messages to display. */
        update_configuration_warnings(): void
        
        /** This function is similar to [method Object.call_deferred] except that the call will take place when the node thread group is processed. If the node thread group processes in sub-threads, then the call will be done on that thread, right before [constant NOTIFICATION_PROCESS] or [constant NOTIFICATION_PHYSICS_PROCESS], the [method _process] or [method _physics_process] or their internal versions are called. */
        call_deferred_thread_group(method: StringName, ...varargs: any[]): any
        
        /** Similar to [method call_deferred_thread_group], but for setting properties. */
        set_deferred_thread_group(property: StringName, value: any): void
        
        /** Similar to [method call_deferred_thread_group], but for notifications. */
        notify_deferred_thread_group(what: int64): void
        
        /** This function ensures that the calling of this function will succeed, no matter whether it's being done from a thread or not. If called from a thread that is not allowed to call the function, the call will become deferred. Otherwise, the call will go through directly. */
        call_thread_safe(method: StringName, ...varargs: any[]): any
        
        /** Similar to [method call_thread_safe], but for setting properties. */
        set_thread_safe(property: StringName, value: any): void
        
        /** Similar to [method call_thread_safe], but for notifications. */
        notify_thread_safe(what: int64): void
        
        /** If `true`, the node can be accessed from any node sharing the same [member owner] or from the [member owner] itself, with special `%Name` syntax in [method get_node].  
         *      
         *  **Note:** If another node with the same [member owner] shares the same [member name] as this node, the other node will no longer be accessible as unique.  
         */
        get unique_name_in_owner(): boolean
        set unique_name_in_owner(value: boolean)
        
        /** The original scene's file path, if the node has been instantiated from a [PackedScene] file. Only scene root nodes contains this. */
        get scene_file_path(): string
        set scene_file_path(value: string)
        
        /** The owner of this node. The owner must be an ancestor of this node. When packing the owner node in a [PackedScene], all the nodes it owns are also saved with it. See also [member unique_name_in_owner].  
         *      
         *  **Note:** In the editor, nodes not owned by the scene root are usually not displayed in the Scene dock, and will **not** be saved. To prevent this, remember to set the owner after calling [method add_child].  
         *      
         *  **Note:** The owner needs to be the current scene root. See [url=https://docs.godotengine.org/en/4.6/tutorials/plugins/running_code_in_the_editor.html#instancing-scenes]Instancing scenes[/url] in the documentation for more information.  
         */
        get owner(): null | Node
        set owner(value: null | Node)
        
        /** The [MultiplayerAPI] instance associated with this node. See [method SceneTree.get_multiplayer].  
         *      
         *  **Note:** Renaming the node, or moving it in the tree, will not move the [MultiplayerAPI] to the new path, you will have to update this manually.  
         */
        get multiplayer(): null | MultiplayerAPI
        
        /** The node's processing behavior. To check if the node can process in its current mode, use [method can_process]. */
        get process_mode(): int64
        set process_mode(value: int64)
        
        /** The node's execution order of the process callbacks ([method _process], [constant NOTIFICATION_PROCESS], and [constant NOTIFICATION_INTERNAL_PROCESS]). Nodes whose priority value is  *lower*  call their process callbacks first, regardless of tree order. */
        get process_priority(): int64
        set process_priority(value: int64)
        
        /** Similar to [member process_priority] but for [constant NOTIFICATION_PHYSICS_PROCESS], [method _physics_process], or [constant NOTIFICATION_INTERNAL_PHYSICS_PROCESS]. */
        get process_physics_priority(): int64
        set process_physics_priority(value: int64)
        
        /** Set the process thread group for this node (basically, whether it receives [constant NOTIFICATION_PROCESS], [constant NOTIFICATION_PHYSICS_PROCESS], [method _process] or [method _physics_process] (and the internal versions) on the main thread or in a sub-thread.  
         *  By default, the thread group is [constant PROCESS_THREAD_GROUP_INHERIT], which means that this node belongs to the same thread group as the parent node. The thread groups means that nodes in a specific thread group will process together, separate to other thread groups (depending on [member process_thread_group_order]). If the value is set is [constant PROCESS_THREAD_GROUP_SUB_THREAD], this thread group will occur on a sub thread (not the main thread), otherwise if set to [constant PROCESS_THREAD_GROUP_MAIN_THREAD] it will process on the main thread. If there is not a parent or grandparent node set to something other than inherit, the node will belong to the  *default thread group* . This default group will process on the main thread and its group order is 0.  
         *  During processing in a sub-thread, accessing most functions in nodes outside the thread group is forbidden (and it will result in an error in debug mode). Use [method Object.call_deferred], [method call_thread_safe], [method call_deferred_thread_group] and the likes in order to communicate from the thread groups to the main thread (or to other thread groups).  
         *  To better understand process thread groups, the idea is that any node set to any other value than [constant PROCESS_THREAD_GROUP_INHERIT] will include any child (and grandchild) nodes set to inherit into its process thread group. This means that the processing of all the nodes in the group will happen together, at the same time as the node including them.  
         */
        get process_thread_group(): int64
        set process_thread_group(value: int64)
        
        /** Change the process thread group order. Groups with a lesser order will process before groups with a greater order. This is useful when a large amount of nodes process in sub thread and, afterwards, another group wants to collect their result in the main thread, as an example. */
        get process_thread_group_order(): int64
        set process_thread_group_order(value: int64)
        
        /** Set whether the current thread group will process messages (calls to [method call_deferred_thread_group] on threads), and whether it wants to receive them during regular process or physics process callbacks. */
        get process_thread_messages(): int64
        set process_thread_messages(value: int64)
        
        /** The physics interpolation mode to use for this node. Only effective if [member ProjectSettings.physics/common/physics_interpolation] or [member SceneTree.physics_interpolation] is `true`.  
         *  By default, nodes inherit the physics interpolation mode from their parent. This property can enable or disable physics interpolation individually for each node, regardless of their parents' physics interpolation mode.  
         *      
         *  **Note:** Some node types like [VehicleWheel3D] have physics interpolation disabled by default, as they rely on their own custom solution.  
         *      
         *  **Note:** When teleporting a node to a distant position, it's recommended to temporarily disable interpolation with [method Node.reset_physics_interpolation]  *after*  moving the node. This avoids creating a visual streak between the old and new positions.  
         */
        get physics_interpolation_mode(): int64
        set physics_interpolation_mode(value: int64)
        
        /** Defines if any text should automatically change to its translated version depending on the current locale (for nodes such as [Label], [RichTextLabel], [Window], etc.). Also decides if the node's strings should be parsed for translation template generation.  
         *      
         *  **Note:** For the root node, auto translate mode can also be set via [member ProjectSettings.internationalization/rendering/root_node_auto_translate].  
         */
        get auto_translate_mode(): int64
        set auto_translate_mode(value: int64)
        
        /** An optional description to the node. It will be displayed as a tooltip when hovering over the node in the editor's Scene dock. */
        get editor_description(): string
        set editor_description(value: string)
        
        /** Emitted when the node is considered ready, after [method _ready] is called. */
        readonly ready: Signal<() => void>
        
        /** Emitted when the node's [member name] is changed, if the node is inside the tree. */
        readonly renamed: Signal<() => void>
        
        /** Emitted when the node enters the tree.  
         *  This signal is emitted  *after*  the related [constant NOTIFICATION_ENTER_TREE] notification.  
         */
        readonly tree_entered: Signal<() => void>
        
        /** Emitted when the node is just about to exit the tree. The node is still valid. As such, this is the right place for de-initialization (or a "destructor", if you will).  
         *  This signal is emitted  *after*  the node's [method _exit_tree], and  *before*  the related [constant NOTIFICATION_EXIT_TREE].  
         */
        readonly tree_exiting: Signal<() => void>
        
        /** Emitted after the node exits the tree and is no longer active.  
         *  This signal is emitted  *after*  the related [constant NOTIFICATION_EXIT_TREE] notification.  
         */
        readonly tree_exited: Signal<() => void>
        
        /** Emitted when the child [param node] enters the [SceneTree], usually because this node entered the tree (see [signal tree_entered]), or [method add_child] has been called.  
         *  This signal is emitted  *after*  the child node's own [constant NOTIFICATION_ENTER_TREE] and [signal tree_entered].  
         */
        readonly child_entered_tree: Signal<(node: Node) => void>
        
        /** Emitted when the child [param node] is about to exit the [SceneTree], usually because this node is exiting the tree (see [signal tree_exiting]), or because the child [param node] is being removed or freed.  
         *  When this signal is received, the child [param node] is still accessible inside the tree. This signal is emitted  *after*  the child node's own [signal tree_exiting] and [constant NOTIFICATION_EXIT_TREE].  
         */
        readonly child_exiting_tree: Signal<(node: Node) => void>
        
        /** Emitted when the list of children is changed. This happens when child nodes are added, moved or removed. */
        readonly child_order_changed: Signal<() => void>
        
        /** Emitted when this node is being replaced by the [param node], see [method replace_by].  
         *  This signal is emitted  *after*  [param node] has been added as a child of the original parent node, but  *before*  all original child nodes have been reparented to [param node].  
         */
        readonly replacing_by: Signal<(node: Node) => void>
        
        /** Emitted when the node's editor description field changed. */
        readonly editor_description_changed: Signal<(node: Node) => void>
        
        /** Emitted when an attribute of the node that is relevant to the editor is changed. Only emitted in the editor. */
        readonly editor_state_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNode;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNode2D extends __NameMapCanvasItem {
    }
    /** A 2D game object, inherited by all 2D-related nodes. Has a position, rotation, scale, and skew.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_node2d.html  
     */
    class Node2D<Map extends NodePathMap = any> extends CanvasItem<Map> {
        constructor(identifier?: any)
        /** Applies a rotation to the node, in radians, starting from its current rotation. This is equivalent to `rotation += radians`. */
        rotate(radians: float64): void
        
        /** Applies a local translation on the node's X axis with the amount specified in [param delta]. If [param scaled] is `false`, normalizes the movement to occur independently of the node's [member scale]. */
        move_local_x(delta: float64, scaled?: boolean /* = false */): void
        
        /** Applies a local translation on the node's Y axis with the amount specified in [param delta]. If [param scaled] is `false`, normalizes the movement to occur independently of the node's [member scale]. */
        move_local_y(delta: float64, scaled?: boolean /* = false */): void
        
        /** Translates the node by the given [param offset] in local coordinates. This is equivalent to `position += offset`. */
        translate(offset: Vector2): void
        
        /** Adds the [param offset] vector to the node's global position. */
        global_translate(offset: Vector2): void
        
        /** Multiplies the current scale by the [param ratio] vector. */
        apply_scale(ratio: Vector2): void
        
        /** Rotates the node so that its local +X axis points towards the [param point], which is expected to use global coordinates. This method is a combination of both [method rotate] and [method get_angle_to].  
         *  [param point] should not be the same as the node's position, otherwise the node always looks to the right.  
         */
        look_at(point: Vector2): void
        
        /** Returns the angle between the node and the [param point] in radians. See also [method look_at].  
         *  [url=https://raw.githubusercontent.com/godotengine/godot-docs/master/img/node2d_get_angle_to.png]Illustration of the returned angle.[/url]  
         */
        get_angle_to(point: Vector2): float64
        
        /** Transforms the provided global position into a position in local coordinate space. The output will be local relative to the [Node2D] it is called on. e.g. It is appropriate for determining the positions of child nodes, but it is not appropriate for determining its own position relative to its parent. */
        to_local(global_point: Vector2): Vector2
        
        /** Transforms the provided local position into a position in global coordinate space. The input is expected to be local relative to the [Node2D] it is called on. e.g. Applying this method to the positions of child nodes will correctly transform their positions into the global coordinate space, but applying it to a node's own position will give an incorrect result, as it will incorporate the node's own transformation into its global position. */
        to_global(local_point: Vector2): Vector2
        
        /** Returns the [Transform2D] relative to this node's parent. */
        get_relative_transform_to_parent(parent: Node): Transform2D
        
        /** Position, relative to the node's parent. See also [member global_position]. */
        get position(): Vector2
        set position(value: Vector2)
        
        /** Rotation in radians, relative to the node's parent. See also [member global_rotation].  
         *      
         *  **Note:** This property is edited in the inspector in degrees. If you want to use degrees in a script, use [member rotation_degrees].  
         */
        get rotation(): float64
        set rotation(value: float64)
        
        /** Helper property to access [member rotation] in degrees instead of radians. See also [member global_rotation_degrees]. */
        get rotation_degrees(): float64
        set rotation_degrees(value: float64)
        
        /** The node's scale, relative to the node's parent. Unscaled value: `(1, 1)`. See also [member global_scale].  
         *      
         *  **Note:** Negative X scales in 2D are not decomposable from the transformation matrix. Due to the way scale is represented with transformation matrices in Godot, negative scales on the X axis will be changed to negative scales on the Y axis and a rotation of 180 degrees when decomposed.  
         */
        get scale(): Vector2
        set scale(value: Vector2)
        
        /** If set to a non-zero value, slants the node in one direction or another. This can be used for pseudo-3D effects. See also [member global_skew].  
         *      
         *  **Note:** Skew is performed on the X axis only, and  *between*  rotation and scaling.  
         *      
         *  **Note:** This property is edited in the inspector in degrees. If you want to use degrees in a script, use `skew = deg_to_rad(value_in_degrees)`.  
         */
        get skew(): float64
        set skew(value: float64)
        
        /** The node's [Transform2D], relative to the node's parent. See also [member global_transform]. */
        get transform(): Transform2D
        set transform(value: Transform2D)
        
        /** Global position. See also [member position]. */
        get global_position(): Vector2
        set global_position(value: Vector2)
        
        /** Global rotation in radians. See also [member rotation]. */
        get global_rotation(): float64
        set global_rotation(value: float64)
        
        /** Helper property to access [member global_rotation] in degrees instead of radians. See also [member rotation_degrees]. */
        get global_rotation_degrees(): float64
        set global_rotation_degrees(value: float64)
        
        /** Global scale. See also [member scale]. */
        get global_scale(): Vector2
        set global_scale(value: Vector2)
        
        /** Global skew in radians. See also [member skew]. */
        get global_skew(): float64
        set global_skew(value: float64)
        
        /** Global [Transform2D]. See also [member transform]. */
        get global_transform(): Transform2D
        set global_transform(value: Transform2D)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNode2D;
    }
    namespace Node3D {
        enum RotationEditMode {
            /** The rotation is edited using a [Vector3] in [url=https://en.wikipedia.org/wiki/Euler_angles]Euler angles[/url]. */
            ROTATION_EDIT_MODE_EULER = 0,
            
            /** The rotation is edited using a [Quaternion]. */
            ROTATION_EDIT_MODE_QUATERNION = 1,
            
            /** The rotation is edited using a [Basis]. In this mode, the raw [member basis]'s axes can be freely modified, but the [member scale] property is not available. */
            ROTATION_EDIT_MODE_BASIS = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNode3D extends __NameMapNode {
    }
    /** Base object in 3D space, inherited by all 3D nodes.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_node3d.html  
     */
    class Node3D<Map extends NodePathMap = any> extends Node<Map> {
        /** Notification received when this node's [member global_transform] changes, if [method is_transform_notification_enabled] is `true`. See also [method set_notify_transform].  
         *      
         *  **Note:** Most 3D nodes such as [VisualInstance3D] or [CollisionObject3D] automatically enable this to function correctly.  
         *      
         *  **Note:** In the editor, nodes will propagate this notification to their children if a gizmo is attached (see [method add_gizmo]).  
         */
        static readonly NOTIFICATION_TRANSFORM_CHANGED = 2000
        
        /** Notification received when this node is registered to a new [World3D] (see [method get_world_3d]). */
        static readonly NOTIFICATION_ENTER_WORLD = 41
        
        /** Notification received when this node is unregistered from the current [World3D] (see [method get_world_3d]).  
         *  This notification is sent in reversed order.  
         */
        static readonly NOTIFICATION_EXIT_WORLD = 42
        
        /** Notification received when this node's visibility changes (see [member visible] and [method is_visible_in_tree]).  
         *  This notification is received  *before*  the related [signal visibility_changed] signal.  
         */
        static readonly NOTIFICATION_VISIBILITY_CHANGED = 43
        
        /** Notification received when this node's [member transform] changes, if [method is_local_transform_notification_enabled] is `true`. This is not received when a parent [Node3D]'s [member transform] changes. See also [method set_notify_local_transform].  
         *      
         *  **Note:** Some 3D nodes such as [CSGShape3D] or [CollisionShape3D] automatically enable this to function correctly.  
         */
        static readonly NOTIFICATION_LOCAL_TRANSFORM_CHANGED = 44
        constructor(identifier?: any)
        
        /** When using physics interpolation, there will be circumstances in which you want to know the interpolated (displayed) transform of a node rather than the standard transform (which may only be accurate to the most recent physics tick).  
         *  This is particularly important for frame-based operations that take place in [method Node._process], rather than [method Node._physics_process]. Examples include [Camera3D]s focusing on a node, or finding where to fire lasers from on a frame rather than physics tick.  
         *      
         *  **Note:** This function creates an interpolation pump on the [Node3D] the first time it is called, which can respond to physics interpolation resets. If you get problems with "streaking" when initially following a [Node3D], be sure to call [method get_global_transform_interpolated] at least once  *before*  resetting the [Node3D] physics interpolation.  
         */
        get_global_transform_interpolated(): Transform3D
        
        /** Returns the parent [Node3D] that directly affects this node's [member global_transform]. Returns `null` if no parent exists, the parent is not a [Node3D], or [member top_level] is `true`.  
         *      
         *  **Note:** This method is not always equivalent to [method Node.get_parent], which does not take [member top_level] into account.  
         */
        get_parent_node_3d(): null | Node3D
        
        /** If `true`, the node will not receive [constant NOTIFICATION_TRANSFORM_CHANGED] or [constant NOTIFICATION_LOCAL_TRANSFORM_CHANGED].  
         *  It may useful to call this method when handling these notifications to prevent infinite recursion.  
         */
        set_ignore_transform_notification(enabled: boolean): void
        
        /** If `true`, this node's [member global_transform] is automatically orthonormalized. This results in this node not appearing distorted, as if its global scale were set to [constant Vector3.ONE] (or its negative counterpart). See also [method is_scale_disabled] and [method orthonormalize].  
         *      
         *  **Note:** [member transform] is not affected by this setting.  
         */
        set_disable_scale(disable: boolean): void
        
        /** Returns `true` if this node's [member global_transform] is automatically orthonormalized. This results in this node not appearing distorted, as if its global scale were set to [constant Vector3.ONE] (or its negative counterpart). See also [method set_disable_scale] and [method orthonormalize].  
         *      
         *  **Note:** [member transform] is not affected by this setting.  
         */
        is_scale_disabled(): boolean
        
        /** Returns the [World3D] this node is registered to.  
         *  Usually, this is the same as the world used by this node's viewport (see [method Node.get_viewport] and [method Viewport.find_world_3d]).  
         */
        get_world_3d(): null | World3D
        
        /** Forces the node's [member global_transform] to update, by sending [constant NOTIFICATION_TRANSFORM_CHANGED]. Fails if the node is not inside the tree.  
         *      
         *  **Note:** For performance reasons, transform changes are usually accumulated and applied  *once*  at the end of the frame. The update propagates through [Node3D] children, as well. Therefore, use this method only when you need an up-to-date transform (such as during physics operations).  
         */
        force_update_transform(): void
        
        /** Updates all the [EditorNode3DGizmo] objects attached to this node. Only works in the editor. */
        update_gizmos(): void
        
        /** Attaches the given [param gizmo] to this node. Only works in the editor.  
         *      
         *  **Note:** [param gizmo] should be an [EditorNode3DGizmo]. The argument type is [Node3DGizmo] to avoid depending on editor classes in [Node3D].  
         */
        add_gizmo(gizmo: Node3DGizmo): void
        
        /** Returns all the [EditorNode3DGizmo] objects attached to this node. Only works in the editor. */
        get_gizmos(): GArray<Node3DGizmo>
        
        /** Clears all [EditorNode3DGizmo] objects attached to this node. Only works in the editor. */
        clear_gizmos(): void
        
        /** Selects the [param gizmo]'s subgizmo with the given [param id] and sets its transform. Only works in the editor.  
         *      
         *  **Note:** The gizmo object would typically be an instance of [EditorNode3DGizmo], but the argument type is kept generic to avoid creating a dependency on editor classes in [Node3D].  
         */
        set_subgizmo_selection(gizmo: Node3DGizmo, id: int64, transform: Transform3D): void
        
        /** Deselects all subgizmos for this node. Useful to call when the selected subgizmo may no longer exist after a property change. Only works in the editor. */
        clear_subgizmo_selection(): void
        
        /** Returns `true` if this node is inside the scene tree and the [member visible] property is `true` for this node and all of its [Node3D] ancestors  *in sequence* . An ancestor of any other type (such as [Node] or [Node2D]) breaks the sequence. See also [method Node.get_parent].  
         *      
         *  **Note:** This method cannot take [member VisualInstance3D.layers] into account, so even if this method returns `true`, the node may not be rendered.  
         */
        is_visible_in_tree(): boolean
        
        /** Allows this node to be rendered. Equivalent to setting [member visible] to `true`. This is the opposite of [method hide]. */
        show(): void
        
        /** Prevents this node from being rendered. Equivalent to setting [member visible] to `false`. This is the opposite of [method show]. */
        hide(): void
        
        /** If `true`, the node will receive [constant NOTIFICATION_LOCAL_TRANSFORM_CHANGED] whenever [member transform] changes.  
         *      
         *  **Note:** Some 3D nodes such as [CSGShape3D] or [CollisionShape3D] automatically enable this to function correctly.  
         */
        set_notify_local_transform(enable: boolean): void
        
        /** Returns `true` if the node receives [constant NOTIFICATION_LOCAL_TRANSFORM_CHANGED] whenever [member transform] changes. This is enabled with [method set_notify_local_transform]. */
        is_local_transform_notification_enabled(): boolean
        
        /** If `true`, the node will receive [constant NOTIFICATION_TRANSFORM_CHANGED] whenever [member global_transform] changes.  
         *      
         *  **Note:** Most 3D nodes such as [VisualInstance3D] or [CollisionObject3D] automatically enable this to function correctly.  
         *      
         *  **Note:** In the editor, nodes will propagate this notification to their children if a gizmo is attached (see [method add_gizmo]).  
         */
        set_notify_transform(enable: boolean): void
        
        /** Returns `true` if the node receives [constant NOTIFICATION_TRANSFORM_CHANGED] whenever [member global_transform] changes. This is enabled with [method set_notify_transform]. */
        is_transform_notification_enabled(): boolean
        
        /** Rotates this node's [member basis] around the [param axis] by the given [param angle], in radians. This operation is calculated in parent space (relative to the parent) and preserves the [member position]. */
        rotate(axis: Vector3, angle: float64): void
        
        /** Rotates this node's [member global_basis] around the global [param axis] by the given [param angle], in radians. This operation is calculated in global space (relative to the world) and preserves the [member global_position]. */
        global_rotate(axis: Vector3, angle: float64): void
        
        /** Scales this node's [member global_basis] by the given [param scale] factor. This operation is calculated in global space (relative to the world) and preserves the [member global_position].  
         *      
         *  **Note:** This method is not to be confused with the [member scale] property.  
         */
        global_scale(scale: Vector3): void
        
        /** Adds the given translation [param offset] to the node's [member global_position] in global space (relative to the world). */
        global_translate(offset: Vector3): void
        
        /** Rotates this node's [member basis] around the [param axis] by the given [param angle], in radians. This operation is calculated in local space (relative to this node) and preserves the [member position]. */
        rotate_object_local(axis: Vector3, angle: float64): void
        
        /** Scales this node's [member basis] by the given [param scale] factor. This operation is calculated in local space (relative to this node) and preserves the [member position]. */
        scale_object_local(scale: Vector3): void
        
        /** Adds the given translation [param offset] to the node's position, in local space (relative to this node). */
        translate_object_local(offset: Vector3): void
        
        /** Rotates this node's [member basis] around the X axis by the given [param angle], in radians. This operation is calculated in parent space (relative to the parent) and preserves the [member position]. */
        rotate_x(angle: float64): void
        
        /** Rotates this node's [member basis] around the Y axis by the given [param angle], in radians. This operation is calculated in parent space (relative to the parent) and preserves the [member position]. */
        rotate_y(angle: float64): void
        
        /** Rotates this node's [member basis] around the Z axis by the given [param angle], in radians. This operation is calculated in parent space (relative to the parent) and preserves the [member position]. */
        rotate_z(angle: float64): void
        
        /** Adds the given translation [param offset] to the node's position, in local space (relative to this node).  
         *      
         *  **Note:** Prefer using [method translate_object_local], instead, as this method may be changed in a future release.  
         *      
         *  **Note:** Despite the naming convention, this operation is **not** calculated in parent space for compatibility reasons. To translate in parent space, add [param offset] to the [member position] (`node_3d.position += offset`).  
         */
        translate(offset: Vector3): void
        
        /** Orthonormalizes this node's [member basis]. This method sets this node's [member scale] to [constant Vector3.ONE] (or its negative counterpart), but preserves the [member position] and [member rotation]. See also [method Transform3D.orthonormalized]. */
        orthonormalize(): void
        
        /** Sets this node's [member transform] to [constant Transform3D.IDENTITY], which resets all transformations in parent space ([member position], [member rotation], and [member scale]). */
        set_identity(): void
        
        /** Rotates the node so that the local forward axis (-Z, [constant Vector3.FORWARD]) points toward the [param target] position. This operation is calculated in global space (relative to the world).  
         *  The local up axis (+Y) points as close to the [param up] vector as possible while staying perpendicular to the local forward axis. The resulting transform is orthogonal, and the scale is preserved. Non-uniform scaling may not work correctly.  
         *  The [param target] position cannot be the same as the node's position, the [param up] vector cannot be [constant Vector3.ZERO]. Furthermore, the direction from the node's position to the [param target] position cannot be parallel to the [param up] vector, to avoid an unintended rotation around the local Z axis.  
         *  If [param use_model_front] is `true`, the +Z axis (asset front) is treated as forward (implies +X is left) and points toward the [param target] position. By default, the -Z axis (camera forward) is treated as forward (implies +X is right).  
         *      
         *  **Note:** This method fails if the node is not in the scene tree. If necessary, use [method look_at_from_position] instead.  
         */
        look_at(target: Vector3, up?: Vector3 /* = Vector3.ZERO */, use_model_front?: boolean /* = false */): void
        
        /** Moves the node to the specified [param position], then rotates the node to point toward the [param target] position, similar to [method look_at]. This operation is calculated in global space (relative to the world). */
        look_at_from_position(position: Vector3, target: Vector3, up?: Vector3 /* = Vector3.ZERO */, use_model_front?: boolean /* = false */): void
        
        /** Returns the [param global_point] converted from global space to this node's local space. This is the opposite of [method to_global]. */
        to_local(global_point: Vector3): Vector3
        
        /** Returns the [param local_point] converted from this node's local space to global space. This is the opposite of [method to_local]. */
        to_global(local_point: Vector3): Vector3
        
        /** The local transformation of this node, in parent space (relative to the parent node). Contains and represents this node's [member position], [member rotation], and [member scale]. */
        get transform(): Transform3D
        set transform(value: Transform3D)
        
        /** The transformation of this node, in global space (relative to the world). Contains and represents this node's [member global_position], [member global_rotation], and global scale.  
         *      
         *  **Note:** If the node is not inside the tree, getting this property fails and returns [constant Transform3D.IDENTITY].  
         */
        get global_transform(): Transform3D
        set global_transform(value: Transform3D)
        
        /** Position (translation) of this node in parent space (relative to the parent node). This is equivalent to the [member transform]'s [member Transform3D.origin]. */
        get position(): Vector3
        set position(value: Vector3)
        
        /** Rotation of this node as [url=https://en.wikipedia.org/wiki/Euler_angles]Euler angles[/url], in radians and in parent space (relative to the parent node). This value is obtained from [member basis]'s rotation.  
         *  - The [member Vector3.x] is the angle around the local X axis (pitch);  
         *  - The [member Vector3.y] is the angle around the local Y axis (yaw);  
         *  - The [member Vector3.z] is the angle around the local Z axis (roll).  
         *  The order of each consecutive rotation can be changed with [member rotation_order] (see [enum EulerOrder] constants). By default, the YXZ convention is used ([constant EULER_ORDER_YXZ]).  
         *      
         *  **Note:** This property is edited in degrees in the inspector. If you want to use degrees in a script, use [member rotation_degrees].  
         */
        get rotation(): Vector3
        set rotation(value: Vector3)
        
        /** The [member rotation] of this node, in degrees instead of radians.  
         *      
         *  **Note:** This is **not** the property available in the Inspector dock.  
         */
        get rotation_degrees(): Vector3
        set rotation_degrees(value: Vector3)
        
        /** Rotation of this node represented as a [Quaternion] in parent space (relative to the parent node). This value is obtained from [member basis]'s rotation.  
         *      
         *  **Note:** Quaternions are much more suitable for 3D math but are less intuitive. Setting this property can be useful for interpolation (see [method Quaternion.slerp]).  
         */
        get quaternion(): Quaternion
        set quaternion(value: Quaternion)
        
        /** Basis of the [member transform] property. Represents the rotation, scale, and shear of this node in parent space (relative to the parent node). */
        get basis(): Basis
        set basis(value: Basis)
        
        /** Scale of this node in local space (relative to this node). This value is obtained from [member basis]'s scale.  
         *      
         *  **Note:** The behavior of some 3D node types is not affected by this property. These include [Light3D], [Camera3D], [AudioStreamPlayer3D], and more.  
         *  **Warning:** The scale's components must either be all positive or all negative, and **not** exactly `0.0`. Otherwise, it won't be possible to obtain the scale from the [member basis]. This may cause the intended scale to be lost when reloaded from disk, and potentially other unstable behavior.  
         */
        get scale(): Vector3
        set scale(value: Vector3)
        
        /** How this node's rotation and scale are displayed in the Inspector dock. */
        get rotation_edit_mode(): int64
        set rotation_edit_mode(value: int64)
        
        /** The axis rotation order of the [member rotation] property. The final orientation is calculated by rotating around the local X, Y, and Z axis in this order. */
        get rotation_order(): int64
        set rotation_order(value: int64)
        
        /** If `true`, the node does not inherit its transformations from its parent. As such, node transformations will only be in global space, which also means that [member global_transform] and [member transform] will be identical. */
        get top_level(): boolean
        set top_level(value: boolean)
        
        /** Global position (translation) of this node in global space (relative to the world). This is equivalent to the [member global_transform]'s [member Transform3D.origin].  
         *      
         *  **Note:** If the node is not inside the tree, getting this property fails and returns [constant Vector3.ZERO].  
         */
        get global_position(): Vector3
        set global_position(value: Vector3)
        
        /** Basis of the [member global_transform] property. Represents the rotation, scale, and shear of this node in global space (relative to the world).  
         *      
         *  **Note:** If the node is not inside the tree, getting this property fails and returns [constant Basis.IDENTITY].  
         */
        get global_basis(): Basis
        set global_basis(value: Basis)
        
        /** Global rotation of this node as [url=https://en.wikipedia.org/wiki/Euler_angles]Euler angles[/url], in radians and in global space (relative to the world). This value is obtained from [member global_basis]'s rotation.  
         *  - The [member Vector3.x] is the angle around the global X axis (pitch);  
         *  - The [member Vector3.y] is the angle around the global Y axis (yaw);  
         *  - The [member Vector3.z] is the angle around the global Z axis (roll).  
         *      
         *  **Note:** Unlike [member rotation], this property always follows the YXZ convention ([constant EULER_ORDER_YXZ]).  
         *      
         *  **Note:** If the node is not inside the tree, getting this property fails and returns [constant Vector3.ZERO].  
         */
        get global_rotation(): Vector3
        set global_rotation(value: Vector3)
        
        /** The [member global_rotation] of this node, in degrees instead of radians.  
         *      
         *  **Note:** If the node is not inside the tree, getting this property fails and returns [constant Vector3.ZERO].  
         */
        get global_rotation_degrees(): Vector3
        set global_rotation_degrees(value: Vector3)
        
        /** If `true`, this node can be visible. The node is only rendered when all of its ancestors are visible, as well. That means [method is_visible_in_tree] must return `true`. */
        get visible(): boolean
        set visible(value: boolean)
        
        /** Path to the visibility range parent for this node and its descendants. The visibility parent must be a [GeometryInstance3D].  
         *  Any visual instance will only be visible if the visibility parent (and all of its visibility ancestors) is hidden by being closer to the camera than its own [member GeometryInstance3D.visibility_range_begin]. Nodes hidden via the [member Node3D.visible] property are essentially removed from the visibility dependency tree, so dependent instances will not take the hidden node or its descendants into account.  
         */
        get visibility_parent(): NodePath
        set visibility_parent(value: NodePath | string)
        
        /** Emitted when this node's visibility changes (see [member visible] and [method is_visible_in_tree]).  
         *  This signal is emitted  *after*  the related [constant NOTIFICATION_VISIBILITY_CHANGED] notification.  
         */
        readonly visibility_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNode3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNode3DGizmo extends __NameMapRefCounted {
    }
    /** Abstract class to expose editor gizmos for [Node3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_node3dgizmo.html  
     */
    class Node3DGizmo extends RefCounted {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNode3DGizmo;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNoise extends __NameMapResource {
    }
    /** Abstract base class for noise generators.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_noise.html  
     */
    class Noise extends Resource {
        constructor(identifier?: any)
        /** Returns the 1D noise value at the given (x) coordinate. */
        get_noise_1d(x: float64): float64
        
        /** Returns the 2D noise value at the given position. */
        get_noise_2d(x: float64, y: float64): float64
        
        /** Returns the 2D noise value at the given position. */
        get_noise_2dv(v: Vector2): float64
        
        /** Returns the 3D noise value at the given position. */
        get_noise_3d(x: float64, y: float64, z: float64): float64
        
        /** Returns the 3D noise value at the given position. */
        get_noise_3dv(v: Vector3): float64
        
        /** Returns an [Image] containing 2D noise values.  
         *      
         *  **Note:** With [param normalize] set to `false`, the default implementation expects the noise generator to return values in the range `-1.0` to `1.0`.  
         */
        get_image(width: int64, height: int64, invert?: boolean /* = false */, in_3d_space?: boolean /* = false */, normalize?: boolean /* = true */): null | Image
        
        /** Returns an [Image] containing seamless 2D noise values.  
         *      
         *  **Note:** With [param normalize] set to `false`, the default implementation expects the noise generator to return values in the range `-1.0` to `1.0`.  
         */
        get_seamless_image(width: int64, height: int64, invert?: boolean /* = false */, in_3d_space?: boolean /* = false */, skirt?: float64 /* = 0.1 */, normalize?: boolean /* = true */): null | Image
        
        /** Returns an [Array] of [Image]s containing 3D noise values for use with [method ImageTexture3D.create].  
         *      
         *  **Note:** With [param normalize] set to `false`, the default implementation expects the noise generator to return values in the range `-1.0` to `1.0`.  
         */
        get_image_3d(width: int64, height: int64, depth: int64, invert?: boolean /* = false */, normalize?: boolean /* = true */): GArray<Image>
        
        /** Returns an [Array] of [Image]s containing seamless 3D noise values for use with [method ImageTexture3D.create].  
         *      
         *  **Note:** With [param normalize] set to `false`, the default implementation expects the noise generator to return values in the range `-1.0` to `1.0`.  
         */
        get_seamless_image_3d(width: int64, height: int64, depth: int64, invert?: boolean /* = false */, skirt?: float64 /* = 0.1 */, normalize?: boolean /* = true */): GArray<Image>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNoise;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNoiseTexture2D extends __NameMapTexture2D {
    }
    /** A 2D texture filled with noise generated by a [Noise] object.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_noisetexture2d.html  
     */
    class NoiseTexture2D extends Texture2D {
        constructor(identifier?: any)
        /** Width of the generated texture (in pixels). */
        get width(): int64
        set width(value: int64)
        
        /** Height of the generated texture (in pixels). */
        get height(): int64
        set height(value: int64)
        
        /** Determines whether mipmaps are generated for this texture. Enabling this results in less texture aliasing in the distance, at the cost of increasing memory usage by roughly 33% and making the noise texture generation take longer.  
         *      
         *  **Note:** [member generate_mipmaps] requires mipmap filtering to be enabled on the material using the [NoiseTexture2D] to have an effect.  
         */
        get generate_mipmaps(): boolean
        set generate_mipmaps(value: boolean)
        
        /** The instance of the [Noise] object. */
        get noise(): null | Noise
        set noise(value: null | Noise)
        
        /** A [Gradient] which is used to map the luminance of each pixel to a color value. */
        get color_ramp(): null | Gradient
        set color_ramp(value: null | Gradient)
        
        /** If `true`, a seamless texture is requested from the [Noise] resource.  
         *      
         *  **Note:** Seamless noise textures may take longer to generate and/or can have a lower contrast compared to non-seamless noise depending on the used [Noise] resource. This is because some implementations use higher dimensions for generating seamless noise.  
         *      
         *  **Note:** The default [FastNoiseLite] implementation uses the fallback path for seamless generation. If using a [member width] or [member height] lower than the default, you may need to increase [member seamless_blend_skirt] to make seamless blending more effective.  
         */
        get seamless(): boolean
        set seamless(value: boolean)
        
        /** If `true`, inverts the noise texture. White becomes black, black becomes white. */
        get invert(): boolean
        set invert(value: boolean)
        
        /** Determines whether the noise image is calculated in 3D space. May result in reduced contrast. */
        get in_3d_space(): boolean
        set in_3d_space(value: boolean)
        
        /** If `true`, the resulting texture contains a normal map created from the original noise interpreted as a bump map. */
        get as_normal_map(): boolean
        set as_normal_map(value: boolean)
        
        /** If `true`, the noise image coming from the noise generator is normalized to the range `0.0` to `1.0`.  
         *  Turning normalization off can affect the contrast and allows you to generate non repeating tileable noise textures.  
         */
        get normalize(): boolean
        set normalize(value: boolean)
        
        /** Used for the default/fallback implementation of the seamless texture generation. It determines the distance over which the seams are blended. High values may result in less details and contrast. See [Noise] for further details.  
         *      
         *  **Note:** If using a [member width] or [member height] lower than the default, you may need to increase [member seamless_blend_skirt] to make seamless blending more effective.  
         */
        get seamless_blend_skirt(): float64
        set seamless_blend_skirt(value: float64)
        
        /** Strength of the bump maps used in this texture. A higher value will make the bump maps appear larger while a lower value will make them appear softer. */
        get bump_strength(): float64
        set bump_strength(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNoiseTexture2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapNoiseTexture3D extends __NameMapTexture3D {
    }
    /** A 3D texture filled with noise generated by a [Noise] object.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_noisetexture3d.html  
     */
    class NoiseTexture3D extends Texture3D {
        constructor(identifier?: any)
        /** Width of the generated texture (in pixels). */
        get width(): int64
        set width(value: int64)
        
        /** Height of the generated texture (in pixels). */
        get height(): int64
        set height(value: int64)
        
        /** Depth of the generated texture (in pixels). */
        get depth(): int64
        set depth(value: int64)
        
        /** The instance of the [Noise] object. */
        get noise(): null | Noise
        set noise(value: null | Noise)
        
        /** A [Gradient] which is used to map the luminance of each pixel to a color value. */
        get color_ramp(): null | Gradient
        set color_ramp(value: null | Gradient)
        
        /** If `true`, a seamless texture is requested from the [Noise] resource.  
         *      
         *  **Note:** Seamless noise textures may take longer to generate and/or can have a lower contrast compared to non-seamless noise depending on the used [Noise] resource. This is because some implementations use higher dimensions for generating seamless noise.  
         *      
         *  **Note:** The default [FastNoiseLite] implementation uses the fallback path for seamless generation. If using a [member width], [member height] or [member depth] lower than the default, you may need to increase [member seamless_blend_skirt] to make seamless blending more effective.  
         */
        get seamless(): boolean
        set seamless(value: boolean)
        
        /** If `true`, inverts the noise texture. White becomes black, black becomes white. */
        get invert(): boolean
        set invert(value: boolean)
        
        /** If `true`, the noise image coming from the noise generator is normalized to the range `0.0` to `1.0`.  
         *  Turning normalization off can affect the contrast and allows you to generate non repeating tileable noise textures.  
         */
        get normalize(): boolean
        set normalize(value: boolean)
        
        /** Used for the default/fallback implementation of the seamless texture generation. It determines the distance over which the seams are blended. High values may result in less details and contrast. See [Noise] for further details.  
         *      
         *  **Note:** If using a [member width], [member height] or [member depth] lower than the default, you may need to increase [member seamless_blend_skirt] to make seamless blending more effective.  
         */
        get seamless_blend_skirt(): float64
        set seamless_blend_skirt(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapNoiseTexture3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapORMMaterial3D extends __NameMapBaseMaterial3D {
    }
    /** A PBR (Physically Based Rendering) material to be used on 3D objects. Uses an ORM texture.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_ormmaterial3d.html  
     */
    class ORMMaterial3D extends BaseMaterial3D {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapORMMaterial3D;
    }
    namespace Object {
        enum ConnectFlags {
            /** Deferred connections trigger their [Callable]s on idle time (at the end of the frame), rather than instantly. */
            CONNECT_DEFERRED = 1,
            
            /** Persisting connections are stored when the object is serialized (such as when using [method PackedScene.pack]). In the editor, connections created through the Signals dock are always persisting.  
             *      
             *  **Note:** Connections to lambda functions (that is, when the function code is embedded in the [method connect] call) cannot be made persistent.  
             */
            CONNECT_PERSIST = 2,
            
            /** One-shot connections disconnect themselves after emission. */
            CONNECT_ONE_SHOT = 4,
            
            /** Reference-counted connections can be assigned to the same [Callable] multiple times. Each disconnection decreases the internal counter. The signal fully disconnects only when the counter reaches 0. */
            CONNECT_REFERENCE_COUNTED = 8,
            
            /** On signal emission, the source object is automatically appended after the original arguments of the signal, regardless of the connected [Callable]'s unbinds which affect only the original arguments of the signal (see [method Callable.unbind], [method Callable.get_unbound_arguments_count]).  
             *    
             */
            CONNECT_APPEND_SOURCE_OBJECT = 16,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapObject {
    }
    /** Base class for all other classes in the engine.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_object.html  
     */
    class Object {
        /** Notification received when the object is initialized, before its script is attached. Used internally. */
        static readonly NOTIFICATION_POSTINITIALIZE = 0
        
        /** Notification received when the object is about to be deleted. Can be used like destructors in object-oriented programming languages.  
         *  This notification is sent in reversed order.  
         */
        static readonly NOTIFICATION_PREDELETE = 1
        
        /** Notification received when the object finishes hot reloading. This notification is only sent for extensions classes and derived. */
        static readonly NOTIFICATION_EXTENSION_RELOADED = 2
        constructor(identifier?: any)
        
        /** Deletes the object from memory. Pre-existing references to the object become invalid, and any attempt to access them will result in a runtime error. Checking the references with [method @GlobalScope.is_instance_valid] will return `false`. This is equivalent to the `memdelete` function in GDExtension C++. */
        /* gdvirtual */ free(): void
        
        /** Called when the object's script is instantiated, oftentimes after the object is initialized in memory (through `Object.new()` in GDScript, or `new GodotObject` in C#). It can be also defined to take in parameters. This method is similar to a constructor in most programming languages.  
         *      
         *  **Note:** If [method _init] is defined with  *required*  parameters, the Object with script may only be created directly. If any other means (such as [method PackedScene.instantiate] or [method Node.duplicate]) are used, the script's initialization will fail.  
         */
        /* gdvirtual */ _init(): void
        
        /** Override this method to customize the return value of [method to_string], and therefore the object's representation as a [String].  
         *    
         */
        /* gdvirtual */ _to_string(): string
        
        /** Called when the object receives a notification, which can be identified in [param what] by comparing it with a constant. See also [method notification].  
         *    
         *      
         *  **Note:** The base [Object] defines a few notifications ([constant NOTIFICATION_POSTINITIALIZE] and [constant NOTIFICATION_PREDELETE]). Inheriting classes such as [Node] define a lot more notifications, which are also received by this method.  
         *      
         *  **Note:** Unlike other virtual methods, this method is called automatically for every script that overrides it. This means that the base implementation should not be called via `super` in GDScript or its equivalents in other languages. Call order depends on the `reversed` argument of [method notification] and varies between different notifications. Most notifications are sent in the forward order (i.e. Object class first, most derived class last).  
         */
        /* gdvirtual */ _notification(what: int64): void
        
        /** Override this method to customize the behavior of [method set]. Should set the [param property] to [param value] and return `true`, or `false` if the [param property] should be handled normally. The  *exact*  way to set the [param property] is up to this method's implementation.  
         *  Combined with [method _get] and [method _get_property_list], this method allows defining custom properties, which is particularly useful for editor plugins.  
         *      
         *  **Note:** This method is not called when setting built-in properties of an object, including properties defined with [annotation @GDScript.@export].  
         *    
         *      
         *  **Note:** Unlike other virtual methods, this method is called automatically for every script that overrides it. This means that the base implementation should not be called via `super` in GDScript or its equivalents in other languages. The bottom-most sub-class will be called first, with subsequent calls ascending the class hierarchy. The call chain will stop on the first class that returns `true`.  
         */
        /* gdvirtual */ _set(property: StringName, value: any): boolean
        
        /** Override this method to customize the behavior of [method get]. Should return the given [param property]'s value, or `null` if the [param property] should be handled normally.  
         *  Combined with [method _set] and [method _get_property_list], this method allows defining custom properties, which is particularly useful for editor plugins.  
         *      
         *  **Note:** This method is not called when getting built-in properties of an object, including properties defined with [annotation @GDScript.@export].  
         *    
         *      
         *  **Note:** Unlike other virtual methods, this method is called automatically for every script that overrides it. This means that the base implementation should not be called via `super` in GDScript or its equivalents in other languages. The bottom-most sub-class will be called first, with subsequent calls ascending the class hierarchy. The call chain will stop on the first class that returns a non-`null` value.  
         */
        /* gdvirtual */ _get(property: StringName): any
        
        /** Override this method to provide a custom list of additional properties to handle by the engine.  
         *  Should return a property list, as an [Array] of dictionaries. The result is added to the array of [method get_property_list], and should be formatted in the same way. Each [Dictionary] must at least contain the `name` and `type` entries.  
         *  You can use [method _property_can_revert] and [method _property_get_revert] to customize the default values of the properties added by this method.  
         *  The example below displays a list of numbers shown as words going from `ZERO` to `FIVE`, with `number_count` controlling the size of the list:  
         *    
         *      
         *  **Note:** This method is intended for advanced purposes. For most common use cases, the scripting languages offer easier ways to handle properties. See [annotation @GDScript.@export], [annotation @GDScript.@export_enum], [annotation @GDScript.@export_group], etc. If you want to customize exported properties, use [method _validate_property].  
         *      
         *  **Note:** If the object's script is not [annotation @GDScript.@tool], this method will not be called in the editor.  
         *      
         *  **Note:** Unlike other virtual methods, this method is called automatically for every script that overrides it. This means that the base implementation should not be called via `super` in GDScript or its equivalents in other languages. The bottom-most sub-class will be called first, with subsequent calls ascending the class hierarchy.  
         */
        /* gdvirtual */ _get_property_list(): GArray<GDictionary>
        
        /** Override this method to customize existing properties. Every property info goes through this method, except properties added with [method _get_property_list]. The dictionary contents is the same as in [method _get_property_list].  
         *    
         */
        /* gdvirtual */ _validate_property(property: GDictionary): void
        
        /** Override this method to customize the given [param property]'s revert behavior. Should return `true` if the [param property] has a custom default value and is revertible in the Inspector dock. Use [method _property_get_revert] to specify the [param property]'s default value.  
         *      
         *  **Note:** This method must return consistently, regardless of the current value of the [param property].  
         *      
         *  **Note:** Unlike other virtual methods, this method is called automatically for every script that overrides it. This means that the base implementation should not be called via `super` in GDScript or its equivalents in other languages. The bottom-most sub-class will be called first, with subsequent calls ascending the class hierarchy. The call chain will stop on the first class that returns `true`.  
         */
        /* gdvirtual */ _property_can_revert(property: StringName): boolean
        
        /** Override this method to customize the given [param property]'s revert behavior. Should return the default value for the [param property]. If the default value differs from the [param property]'s current value, a revert icon is displayed in the Inspector dock.  
         *      
         *  **Note:** [method _property_can_revert] must also be overridden for this method to be called.  
         *      
         *  **Note:** Unlike other virtual methods, this method is called automatically for every script that overrides it. This means that the base implementation should not be called via `super` in GDScript or its equivalents in other languages. The bottom-most sub-class will be called first, with subsequent calls ascending the class hierarchy. The call chain will stop on the first class that returns a non-`null` value.  
         */
        /* gdvirtual */ _property_get_revert(property: StringName): any
        
        /** Initializes the iterator. [param iter] stores the iteration state. Since GDScript does not support passing arguments by reference, a single-element array is used as a wrapper. Returns `true` so long as the iterator has not reached the end.  
         *    
         *      
         *  **Note:** Alternatively, you can ignore [param iter] and use the object's state instead, see [url=https://docs.godotengine.org/en/4.6/tutorials/scripting/gdscript/gdscript_advanced.html#custom-iterators]online docs[/url] for an example. Note that in this case you will not be able to reuse the same iterator instance in nested loops. Also, make sure you reset the iterator state in this method if you want to reuse the same instance multiple times.  
         */
        /* gdvirtual */ _iter_init(iter: GArray): boolean
        
        /** Moves the iterator to the next iteration. [param iter] stores the iteration state. Since GDScript does not support passing arguments by reference, a single-element array is used as a wrapper. Returns `true` so long as the iterator has not reached the end. */
        /* gdvirtual */ _iter_next(iter: GArray): boolean
        
        /** Returns the current iterable value. [param iter] stores the iteration state, but unlike [method _iter_init] and [method _iter_next] the state is supposed to be read-only, so there is no [Array] wrapper.  
         *  **Tip:** In GDScript, you can use a subtype of [Variant] as the return type for [method _iter_get]. The specified type will be used to set the type of the iterator variable in `for` loops, enhancing type safety.  
         */
        /* gdvirtual */ _iter_get(iter: any): any
        
        /** Returns the object's built-in class name, as a [String]. See also [method is_class].  
         *      
         *  **Note:** This method ignores `class_name` declarations. If this object's script has defined a `class_name`, the base, built-in class name is returned instead.  
         */
        get_class(): string
        
        /** Returns `true` if the object inherits from the given [param class]. See also [method get_class].  
         *    
         *      
         *  **Note:** This method ignores `class_name` declarations in the object's script.  
         */
        is_class(class_: string): boolean
        
        /** Assigns [param value] to the given [param property]. If the property does not exist or the given [param value]'s type doesn't match, nothing happens.  
         *    
         *      
         *  **Note:** In C#, [param property] must be in snake_case when referring to built-in Godot properties. Prefer using the names exposed in the `PropertyName` class to avoid allocating a new [StringName] on each call.  
         */
        set(property: StringName, value: any): void
        
        /** Returns the [Variant] value of the given [param property]. If the [param property] does not exist, this method returns `null`.  
         *    
         *      
         *  **Note:** In C#, [param property] must be in snake_case when referring to built-in Godot properties. Prefer using the names exposed in the `PropertyName` class to avoid allocating a new [StringName] on each call.  
         */
        get(property: StringName): any
        
        /** Assigns a new [param value] to the property identified by the [param property_path]. The path should be a [NodePath] relative to this object, and can use the colon character (`:`) to access nested properties.  
         *    
         *      
         *  **Note:** In C#, [param property_path] must be in snake_case when referring to built-in Godot properties. Prefer using the names exposed in the `PropertyName` class to avoid allocating a new [StringName] on each call.  
         */
        set_indexed(property_path: NodePath | string, value: any): void
        
        /** Gets the object's property indexed by the given [param property_path]. The path should be a [NodePath] relative to the current object and can use the colon character (`:`) to access nested properties.  
         *  **Examples:** `"position:x"` or `"material:next_pass:blend_mode"`.  
         *    
         *      
         *  **Note:** In C#, [param property_path] must be in snake_case when referring to built-in Godot properties. Prefer using the names exposed in the `PropertyName` class to avoid allocating a new [StringName] on each call.  
         *      
         *  **Note:** This method does not support actual paths to nodes in the [SceneTree], only sub-property paths. In the context of nodes, use [method Node.get_node_and_resource] instead.  
         */
        get_indexed(property_path: NodePath | string): any
        
        /** Returns the object's property list as an [Array] of dictionaries. Each [Dictionary] contains the following entries:  
         *  - `name` is the property's name, as a [String];  
         *  - `class_name` is an empty [StringName], unless the property is [constant TYPE_OBJECT] and it inherits from a class;  
         *  - `type` is the property's type, as an [int] (see [enum Variant.Type]);  
         *  - `hint` is  *how*  the property is meant to be edited (see [enum PropertyHint]);  
         *  - `hint_string` depends on the hint (see [enum PropertyHint]);  
         *  - `usage` is a combination of [enum PropertyUsageFlags].  
         *      
         *  **Note:** In GDScript, all class members are treated as properties. In C# and GDExtension, it may be necessary to explicitly mark class members as Godot properties using decorators or attributes.  
         */
        get_property_list(): GArray<GDictionary<PropertyInfo>>
        
        /** Returns this object's methods and their signatures as an [Array] of dictionaries. Each [Dictionary] contains the following entries:  
         *  - `name` is the name of the method, as a [String];  
         *  - `args` is an [Array] of dictionaries representing the arguments;  
         *  - `default_args` is the default arguments as an [Array] of variants;  
         *  - `flags` is a combination of [enum MethodFlags];  
         *  - `id` is the method's internal identifier [int];  
         *  - `return` is the returned value, as a [Dictionary];  
         *      
         *  **Note:** The dictionaries of `args` and `return` are formatted identically to the results of [method get_property_list], although not all entries are used.  
         */
        get_method_list(): GArray<GDictionary>
        
        /** Returns `true` if the given [param property] has a custom default value. Use [method property_get_revert] to get the [param property]'s default value.  
         *      
         *  **Note:** This method is used by the Inspector dock to display a revert icon. The object must implement [method _property_can_revert] to customize the default value. If [method _property_can_revert] is not implemented, this method returns `false`.  
         */
        property_can_revert(property: StringName): boolean
        
        /** Returns the custom default value of the given [param property]. Use [method property_can_revert] to check if the [param property] has a custom default value.  
         *      
         *  **Note:** This method is used by the Inspector dock to display a revert icon. The object must implement [method _property_get_revert] to customize the default value. If [method _property_get_revert] is not implemented, this method returns `null`.  
         */
        property_get_revert(property: StringName): any
        
        /** Sends the given [param what] notification to all classes inherited by the object, triggering calls to [method _notification], starting from the highest ancestor (the [Object] class) and going down to the object's script.  
         *  If [param reversed] is `true`, the call order is reversed.  
         *    
         */
        notification(what: int64, reversed?: boolean /* = false */): void
        
        /** Returns a [String] representing the object. Defaults to `"<ClassName#RID>"`. Override [method _to_string] to customize the string representation of the object. */
        to_string(): string
        
        /** Returns the object's unique instance ID. This ID can be saved in [EncodedObjectAsID], and can be used to retrieve this object instance with [method @GlobalScope.instance_from_id].  
         *      
         *  **Note:** This ID is only useful during the current session. It won't correspond to a similar object if the ID is sent over a network, or loaded from a file at a later time.  
         */
        get_instance_id(): int64
        
        /** Attaches [param script] to the object, and instantiates it. As a result, the script's [method _init] is called. A [Script] is used to extend the object's functionality.  
         *  If a script already exists, its instance is detached, and its property values and state are lost. Built-in property values are still kept.  
         */
        set_script(script: null | Script): void
        
        /** Returns the object's [Script] instance, or `null` if no script is attached. */
        get_script(): null | Script
        
        /** Adds or changes the entry [param name] inside the object's metadata. The metadata [param value] can be any [Variant], although some types cannot be serialized correctly.  
         *  If [param value] is `null`, the entry is removed. This is the equivalent of using [method remove_meta]. See also [method has_meta] and [method get_meta].  
         *      
         *  **Note:** A metadata's name must be a valid identifier as per [method StringName.is_valid_identifier] method.  
         *      
         *  **Note:** Metadata that has a name starting with an underscore (`_`) is considered editor-only. Editor-only metadata is not displayed in the Inspector and should not be edited, although it can still be found by this method.  
         */
        set_meta(name: StringName, value: any): void
        
        /** Removes the given entry [param name] from the object's metadata. See also [method has_meta], [method get_meta] and [method set_meta].  
         *      
         *  **Note:** A metadata's name must be a valid identifier as per [method StringName.is_valid_identifier] method.  
         *      
         *  **Note:** Metadata that has a name starting with an underscore (`_`) is considered editor-only. Editor-only metadata is not displayed in the Inspector and should not be edited, although it can still be found by this method.  
         */
        remove_meta(name: StringName): void
        
        /** Returns the object's metadata value for the given entry [param name]. If the entry does not exist, returns [param default]. If [param default] is `null`, an error is also generated.  
         *      
         *  **Note:** A metadata's name must be a valid identifier as per [method StringName.is_valid_identifier] method.  
         *      
         *  **Note:** Metadata that has a name starting with an underscore (`_`) is considered editor-only. Editor-only metadata is not displayed in the Inspector and should not be edited, although it can still be found by this method.  
         */
        get_meta(name: StringName, default_?: any /* = {} */): any
        
        /** Returns `true` if a metadata entry is found with the given [param name]. See also [method get_meta], [method set_meta] and [method remove_meta].  
         *      
         *  **Note:** A metadata's name must be a valid identifier as per [method StringName.is_valid_identifier] method.  
         *      
         *  **Note:** Metadata that has a name starting with an underscore (`_`) is considered editor-only. Editor-only metadata is not displayed in the Inspector and should not be edited, although it can still be found by this method.  
         */
        has_meta(name: StringName): boolean
        
        /** Returns the object's metadata entry names as an [Array] of [StringName]s. */
        get_meta_list(): GArray<StringName>
        
        /** Adds a user-defined signal named [param signal]. Optional arguments for the signal can be added as an [Array] of dictionaries, each defining a `name` [String] and a `type` [int] (see [enum Variant.Type]). See also [method has_user_signal] and [method remove_user_signal].  
         *    
         */
        add_user_signal(signal: string, arguments_?: GArray): void
        
        /** Returns `true` if the given user-defined [param signal] name exists. Only signals added with [method add_user_signal] are included. See also [method remove_user_signal]. */
        has_user_signal(signal: StringName): boolean
        
        /** Removes the given user signal [param signal] from the object. See also [method add_user_signal] and [method has_user_signal]. */
        remove_user_signal(signal: StringName): void
        
        /** Emits the given [param signal] by name. The signal must exist, so it should be a built-in signal of this class or one of its inherited classes, or a user-defined signal (see [method add_user_signal]). This method supports a variable number of arguments, so parameters can be passed as a comma separated list.  
         *  Returns [constant ERR_UNAVAILABLE] if [param signal] does not exist or the parameters are invalid.  
         *    
         *      
         *  **Note:** In C#, [param signal] must be in snake_case when referring to built-in Godot signals. Prefer using the names exposed in the `SignalName` class to avoid allocating a new [StringName] on each call.  
         */
        emit_signal(signal: StringName, ...varargs: any[]): Error
        
        /** Calls the [param method] on the object and returns the result. This method supports a variable number of arguments, so parameters can be passed as a comma separated list.  
         *    
         *      
         *  **Note:** In C#, [param method] must be in snake_case when referring to built-in Godot methods. Prefer using the names exposed in the `MethodName` class to avoid allocating a new [StringName] on each call.  
         */
        call<M extends GodotNames<this>>(method: M, ...args: ResolveGodotNameParameters<this, NoInfer<M>>): ResolveGodotReturnType<this, NoInfer<M>>
        
        /** Calls the [param method] on the object during idle time. Always returns `null`, **not** the method's result.  
         *  Idle time happens mainly at the end of process and physics frames. In it, deferred calls will be run until there are none left, which means you can defer calls from other deferred calls and they'll still be run in the current idle time cycle. This means you should not call a method deferred from itself (or from a method called by it), as this causes infinite recursion the same way as if you had called the method directly.  
         *  This method supports a variable number of arguments, so parameters can be passed as a comma separated list.  
         *    
         *  For methods that are deferred from the same thread, the order of execution at idle time is identical to the order in which [code skip-lint]call_deferred` was called.  
         *  See also [method Callable.call_deferred].  
         *      
         *  **Note:** In C#, [param method] must be in snake_case when referring to built-in Godot methods. Prefer using the names exposed in the `MethodName` class to avoid allocating a new [StringName] on each call.  
         *      
         *  **Note:** If you're looking to delay the function call by a frame, refer to the [signal SceneTree.process_frame] and [signal SceneTree.physics_frame] signals.  
         *    
         */
        call_deferred<M extends GodotNames<this>>(method: M, ...args: ResolveGodotNameParameters<this, NoInfer<M>>): void
        
        /** Assigns [param value] to the given [param property], at the end of the current frame. This is equivalent to calling [method set] through [method call_deferred].  
         *    
         *      
         *  **Note:** In C#, [param property] must be in snake_case when referring to built-in Godot properties. Prefer using the names exposed in the `PropertyName` class to avoid allocating a new [StringName] on each call.  
         */
        set_deferred<P extends GodotNames<this>>(property: P, value: ResolveGodotNameValue<this,  NoInfer<P>>): void
        
        /** Calls the [param method] on the object and returns the result. Unlike [method call], this method expects all parameters to be contained inside [param arg_array].  
         *    
         *      
         *  **Note:** In C#, [param method] must be in snake_case when referring to built-in Godot methods. Prefer using the names exposed in the `MethodName` class to avoid allocating a new [StringName] on each call.  
         */
        callv<M extends GodotNames<this>>(method: M, argArray: GArray<ResolveGodotNameParameters<this, NoInfer<M>>>): ResolveGodotReturnType<this, NoInfer<M>>
        
        /** Returns `true` if the given [param method] name exists in the object.  
         *      
         *  **Note:** In C#, [param method] must be in snake_case when referring to built-in Godot methods. Prefer using the names exposed in the `MethodName` class to avoid allocating a new [StringName] on each call.  
         */
        has_method(method: StringName): boolean
        
        /** Returns the number of arguments of the given [param method] by name.  
         *      
         *  **Note:** In C#, [param method] must be in snake_case when referring to built-in Godot methods. Prefer using the names exposed in the `MethodName` class to avoid allocating a new [StringName] on each call.  
         */
        get_method_argument_count(method: StringName): int64
        
        /** Returns `true` if the given [param signal] name exists in the object.  
         *      
         *  **Note:** In C#, [param signal] must be in snake_case when referring to built-in Godot signals. Prefer using the names exposed in the `SignalName` class to avoid allocating a new [StringName] on each call.  
         */
        has_signal(signal: StringName): boolean
        
        /** Returns the list of existing signals as an [Array] of dictionaries.  
         *      
         *  **Note:** Due to the implementation, each [Dictionary] is formatted very similarly to the returned values of [method get_method_list].  
         */
        get_signal_list(): GArray<GDictionary>
        
        /** Returns an [Array] of connections for the given [param signal] name. Each connection is represented as a [Dictionary] that contains three entries:  
         *  - [code skip-lint]signal` is a reference to the [Signal];  
         *  - `callable` is a reference to the connected [Callable];  
         *  - `flags` is a combination of [enum ConnectFlags].  
         */
        get_signal_connection_list(signal: StringName): GArray<GDictionary>
        
        /** Returns an [Array] of signal connections received by this object. Each connection is represented as a [Dictionary] that contains three entries:  
         *  - `signal` is a reference to the [Signal];  
         *  - `callable` is a reference to the [Callable];  
         *  - `flags` is a combination of [enum ConnectFlags].  
         */
        get_incoming_connections(): GArray<GDictionary>
        
        /** Connects a [param signal] by name to a [param callable]. Optional [param flags] can be also added to configure the connection's behavior (see [enum ConnectFlags] constants).  
         *  A signal can only be connected once to the same [Callable]. If the signal is already connected, this method returns [constant ERR_INVALID_PARAMETER] and generates an error, unless the signal is connected with [constant CONNECT_REFERENCE_COUNTED]. To prevent this, use [method is_connected] first to check for existing connections.  
         *      
         *  **Note:** If the [param callable]'s object is freed, the connection will be lost.  
         *      
         *  **Note:** In GDScript, it is generally recommended to connect signals with [method Signal.connect] instead.  
         *      
         *  **Note:** This method, and all other signal-related methods, are thread-safe.  
         */
        connect(signal: StringName, callable: Callable, flags?: int64 /* = 0 */): Error
        
        /** Disconnects a [param signal] by name from a given [param callable]. If the connection does not exist, generates an error. Use [method is_connected] to make sure that the connection exists. */
        disconnect(signal: StringName, callable: Callable): void
        
        /** Returns `true` if a connection exists between the given [param signal] name and [param callable].  
         *      
         *  **Note:** In C#, [param signal] must be in snake_case when referring to built-in Godot signals. Prefer using the names exposed in the `SignalName` class to avoid allocating a new [StringName] on each call.  
         */
        is_connected(signal: StringName, callable: Callable): boolean
        
        /** Returns `true` if any connection exists on the given [param signal] name.  
         *      
         *  **Note:** In C#, [param signal] must be in snake_case when referring to built-in Godot methods. Prefer using the names exposed in the `SignalName` class to avoid allocating a new [StringName] on each call.  
         */
        has_connections(signal: StringName): boolean
        
        /** If set to `true`, the object becomes unable to emit signals. As such, [method emit_signal] and signal connections will not work, until it is set to `false`. */
        set_block_signals(enable: boolean): void
        
        /** Returns `true` if the object is blocking its signals from being emitted. See [method set_block_signals]. */
        is_blocking_signals(): boolean
        
        /** Emits the [signal property_list_changed] signal. This is mainly used to refresh the editor, so that the Inspector and editor plugins are properly updated. */
        notify_property_list_changed(): void
        
        /** If set to `true`, allows the object to translate messages with [method tr] and [method tr_n]. Enabled by default. See also [method can_translate_messages]. */
        set_message_translation(enable: boolean): void
        
        /** Returns `true` if the object is allowed to translate messages with [method tr] and [method tr_n]. See also [method set_message_translation]. */
        can_translate_messages(): boolean
        
        /** Translates a [param message], using the translation catalogs configured in the Project Settings. Further [param context] can be specified to help with the translation. Note that most [Control] nodes automatically translate their strings, so this method is mostly useful for formatted strings or custom drawn text.  
         *  If [method can_translate_messages] is `false`, or no translation is available, this method returns the [param message] without changes. See [method set_message_translation].  
         *  For detailed examples, see [url=https://docs.godotengine.org/en/4.6/tutorials/i18n/internationalizing_games.html]Internationalizing games[/url].  
         *      
         *  **Note:** This method can't be used without an [Object] instance, as it requires the [method can_translate_messages] method. To translate strings in a static context, use [method TranslationServer.translate].  
         */
        tr(message: StringName, context?: StringName /* = '' */): string
        
        /** Translates a [param message] or [param plural_message], using the translation catalogs configured in the Project Settings. Further [param context] can be specified to help with the translation.  
         *  If [method can_translate_messages] is `false`, or no translation is available, this method returns [param message] or [param plural_message], without changes. See [method set_message_translation].  
         *  The [param n] is the number, or amount, of the message's subject. It is used by the translation system to fetch the correct plural form for the current language.  
         *  For detailed examples, see [url=https://docs.godotengine.org/en/4.6/tutorials/i18n/localization_using_gettext.html]Localization using gettext[/url].  
         *      
         *  **Note:** Negative and [float] numbers may not properly apply to some countable subjects. It's recommended to handle these cases with [method tr].  
         *      
         *  **Note:** This method can't be used without an [Object] instance, as it requires the [method can_translate_messages] method. To translate strings in a static context, use [method TranslationServer.translate_plural].  
         */
        tr_n(message: StringName, plural_message: StringName, n: int64, context?: StringName /* = '' */): string
        
        /** Returns the name of the translation domain used by [method tr] and [method tr_n]. See also [TranslationServer]. */
        get_translation_domain(): StringName
        
        /** Sets the name of the translation domain used by [method tr] and [method tr_n]. See also [TranslationServer]. */
        set_translation_domain(domain: StringName): void
        
        /** Returns `true` if the [method Node.queue_free] method was called for the object. */
        is_queued_for_deletion(): boolean
        
        /** If this method is called during [constant NOTIFICATION_PREDELETE], this object will reject being freed and will remain allocated. This is mostly an internal function used for error handling to avoid the user from freeing objects when they are not intended to. */
        cancel_free(): void
        
        /** Emitted when the object's script is changed.  
         *      
         *  **Note:** When this signal is emitted, the new script is not initialized yet. If you need to access the new script, defer connections to this signal with [constant CONNECT_DEFERRED].  
         */
        readonly script_changed: Signal<() => void>
        
        /** Emitted when [method notify_property_list_changed] is called. */
        readonly property_list_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapObject;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOccluder3D extends __NameMapResource {
    }
    /** Occluder shape resource for use with occlusion culling in [OccluderInstance3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_occluder3d.html  
     */
    class Occluder3D extends Resource {
        constructor(identifier?: any)
        /** Returns the occluder shape's vertex positions. */
        get_vertices(): PackedVector3Array
        
        /** Returns the occluder shape's vertex indices. */
        get_indices(): PackedInt32Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOccluder3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOccluderInstance3D extends __NameMapVisualInstance3D {
    }
    /** Provides occlusion culling for 3D nodes, which improves performance in closed areas.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_occluderinstance3d.html  
     */
    class OccluderInstance3D<Map extends NodePathMap = any> extends VisualInstance3D<Map> {
        constructor(identifier?: any)
        /** Based on [param value], enables or disables the specified layer in the [member bake_mask], given a [param layer_number] between 1 and 32. */
        set_bake_mask_value(layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified layer of the [member bake_mask] is enabled, given a [param layer_number] between 1 and 32. */
        get_bake_mask_value(layer_number: int64): boolean
        _is_editable_3d_polygon(): boolean
        _get_editable_3d_polygon_resource(): null | Resource
        
        /** The occluder resource for this [OccluderInstance3D]. You can generate an occluder resource by selecting an [OccluderInstance3D] node then using the **Bake Occluders** button at the top of the editor.  
         *  You can also draw your own 2D occluder polygon by adding a new [PolygonOccluder3D] resource to the [member occluder] property in the Inspector.  
         *  Alternatively, you can select a primitive occluder to use: [QuadOccluder3D], [BoxOccluder3D] or [SphereOccluder3D].  
         */
        get occluder(): null | Occluder3D
        set occluder(value: null | Occluder3D)
        
        /** The visual layers to account for when baking for occluders. Only [MeshInstance3D]s whose [member VisualInstance3D.layers] match with this [member bake_mask] will be included in the generated occluder mesh. By default, all objects with  *opaque*  materials are taken into account for the occluder baking.  
         *  To improve performance and avoid artifacts, it is recommended to exclude dynamic objects, small objects and fixtures from the baking process by moving them to a separate visual layer and excluding this layer in [member bake_mask].  
         */
        get bake_mask(): int64
        set bake_mask(value: int64)
        
        /** The simplification distance to use for simplifying the generated occluder polygon (in 3D units). Higher values result in a less detailed occluder mesh, which improves performance but reduces culling accuracy.  
         *  The occluder geometry is rendered on the CPU, so it is important to keep its geometry as simple as possible. Since the buffer is rendered at a low resolution, less detailed occluder meshes generally still work well. The default value is fairly aggressive, so you may have to decrease it if you run into false negatives (objects being occluded even though they are visible by the camera). A value of `0.01` will act conservatively, and will keep geometry  *perceptually*  unaffected in the occlusion culling buffer. Depending on the scene, a value of `0.01` may still simplify the mesh noticeably compared to disabling simplification entirely.  
         *  Setting this to `0.0` disables simplification entirely, but vertices in the exact same position will still be merged. The mesh will also be re-indexed to reduce both the number of vertices and indices.  
         *      
         *  **Note:** This uses the [url=https://meshoptimizer.org/]meshoptimizer[/url] library under the hood, similar to LOD generation.  
         */
        get bake_simplification_distance(): float64
        set bake_simplification_distance(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOccluderInstance3D;
    }
    namespace OccluderPolygon2D {
        enum CullMode {
            /** Culling is disabled. See [member cull_mode]. */
            CULL_DISABLED = 0,
            
            /** Culling is performed in the clockwise direction. See [member cull_mode]. */
            CULL_CLOCKWISE = 1,
            
            /** Culling is performed in the counterclockwise direction. See [member cull_mode]. */
            CULL_COUNTER_CLOCKWISE = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOccluderPolygon2D extends __NameMapResource {
    }
    /** Defines a 2D polygon for LightOccluder2D.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_occluderpolygon2d.html  
     */
    class OccluderPolygon2D extends Resource {
        constructor(identifier?: any)
        /** If `true`, closes the polygon. A closed OccluderPolygon2D occludes the light coming from any direction. An opened OccluderPolygon2D occludes the light only at its outline's direction. */
        get closed(): boolean
        set closed(value: boolean)
        
        /** The culling mode to use. */
        get cull_mode(): int64
        set cull_mode(value: int64)
        
        /** A [Vector2] array with the index for polygon's vertices positions. */
        get polygon(): PackedVector2Array
        set polygon(value: PackedVector2Array | Vector2[])
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOccluderPolygon2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOfflineMultiplayerPeer extends __NameMapMultiplayerPeer {
    }
    /** A [MultiplayerPeer] which is always connected and acts as a server.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_offlinemultiplayerpeer.html  
     */
    class OfflineMultiplayerPeer extends MultiplayerPeer {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOfflineMultiplayerPeer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOggPacketSequence extends __NameMapResource {
    }
    /** A sequence of Ogg packets.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_oggpacketsequence.html  
     */
    class OggPacketSequence extends Resource {
        constructor(identifier?: any)
        /** The length of this stream, in seconds. */
        get_length(): float64
        
        /** Contains the raw packets that make up this OggPacketSequence. */
        get packet_data(): GArray<PackedByteArray>
        set packet_data(value: GArray<PackedByteArray>)
        
        /** Contains the granule positions for each page in this packet sequence. */
        get granule_positions(): PackedInt64Array
        set granule_positions(value: PackedInt64Array | int64[])
        
        /** Holds sample rate information about this sequence. Must be set by another class that actually understands the codec. */
        get sampling_rate(): float64
        set sampling_rate(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOggPacketSequence;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOggPacketSequencePlayback extends __NameMapRefCounted {
    }
    /** @link https://docs.godotengine.org/en/4.6/classes/class_oggpacketsequenceplayback.html */
    class OggPacketSequencePlayback extends RefCounted {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOggPacketSequencePlayback;
    }
    namespace OmniLight3D {
        enum ShadowMode {
            /** Shadows are rendered to a dual-paraboloid texture. Faster than [constant SHADOW_CUBE], but lower-quality. */
            SHADOW_DUAL_PARABOLOID = 0,
            
            /** Shadows are rendered to a cubemap. Slower than [constant SHADOW_DUAL_PARABOLOID], but higher-quality. */
            SHADOW_CUBE = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOmniLight3D extends __NameMapLight3D {
    }
    /** Omnidirectional light, such as a light bulb or a candle.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_omnilight3d.html  
     */
    class OmniLight3D<Map extends NodePathMap = any> extends Light3D<Map> {
        constructor(identifier?: any)
        /** The light's radius. Note that the effectively lit area may appear to be smaller depending on the [member omni_attenuation] in use. No matter the [member omni_attenuation] in use, the light will never reach anything outside this radius.  
         *      
         *  **Note:** [member omni_range] is not affected by [member Node3D.scale] (the light's scale or its parent's scale).  
         */
        get omni_range(): float64
        set omni_range(value: float64)
        
        /** Controls the distance attenuation function for omnilights.  
         *  A value of `0.0` will maintain a constant brightness through most of the range, but smoothly attenuate the light at the edge of the range. Use a value of `2.0` for physically accurate lights as it results in the proper inverse square attenutation.  
         *      
         *  **Note:** Setting attenuation to `2.0` or higher may result in distant objects receiving minimal light, even within range. For example, with a range of `4096`, an object at `100` units is attenuated by a factor of `0.0001`. With a default brightness of `1`, the light would not be visible at that distance.  
         *      
         *  **Note:** Using negative or values higher than `10.0` may lead to unexpected results.  
         */
        get omni_attenuation(): float64
        set omni_attenuation(value: float64)
        get omni_shadow_mode(): int64
        set omni_shadow_mode(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOmniLight3D;
    }
    namespace OpenXRAPIExtension {
        enum OpenXRAlphaBlendModeSupport {
            /** Means that [constant XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND] isn't supported at all. */
            OPENXR_ALPHA_BLEND_MODE_SUPPORT_NONE = 0,
            
            /** Means that [constant XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND] is really supported. */
            OPENXR_ALPHA_BLEND_MODE_SUPPORT_REAL = 1,
            
            /** Means that [constant XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND] is emulated. */
            OPENXR_ALPHA_BLEND_MODE_SUPPORT_EMULATING = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRAPIExtension extends __NameMapRefCounted {
    }
    /** Makes the OpenXR API available for GDExtension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrapiextension.html  
     */
    class OpenXRAPIExtension extends RefCounted {
        constructor(identifier?: any)
        /** Returns the version of OpenXR that was initialized. Only valid after the OpenXR instance has been created. See [url=https://registry.khronos.org/OpenXR/specs/1.1/html/xrspec.html#XR_MAKE_VERSION]XR_MAKE_VERSION[/url] for how the version is calculated. */
        get_openxr_version(): int64
        
        /** Returns the [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrInstance.html]XrInstance[/url] created during the initialization of the OpenXR API. */
        get_instance(): int64
        
        /** Returns the ID of the system, which is an [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrSystemId.html]XrSystemId[/url] cast to an integer. */
        get_system_id(): int64
        
        /** Returns the OpenXR session, which is an [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrSession.html]XrSession[/url] cast to an integer. */
        get_session(): int64
        
        /** Creates a [Transform3D] from an [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrPosef.html]XrPosef[/url]. */
        transform_from_pose(pose: int64): Transform3D
        
        /** Returns `true` if the provided [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrResult.html]XrResult[/url] (cast to an integer) is successful. Otherwise returns `false` and prints the [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrResult.html]XrResult[/url] converted to a string, with the specified additional information. */
        xr_result(result: int64, format: string, args: GArray): boolean
        
        /** Returns `true` if OpenXR is enabled. */
        static openxr_is_enabled(check_run_in_editor: boolean): boolean
        
        /** Returns the function pointer of the OpenXR function with the specified name, cast to an integer. If the function with the given name does not exist, the method returns `0`.  
         *      
         *  **Note:** `openxr/util.h` contains utility macros for acquiring OpenXR functions, e.g. `GDEXTENSION_INIT_XR_FUNC_V(xrCreateAction)`.  
         */
        get_instance_proc_addr(name: string): int64
        
        /** Returns an error string for the given [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrResult.html]XrResult[/url]. */
        get_error_string(result: int64): string
        
        /** Returns the name of the specified swapchain format. */
        get_swapchain_format_name(swapchain_format: int64): string
        
        /** Set the object name of an OpenXR object, used for debug output. [param object_type] must be a valid OpenXR `XrObjectType` enum and [param object_handle] must be a valid OpenXR object handle. */
        set_object_name(object_type: int64, object_handle: int64, object_name: string): void
        
        /** Begins a new debug label region, this label will be reported in debug messages for any calls following this until [method end_debug_label_region] is called. Debug labels can be stacked. */
        begin_debug_label_region(label_name: string): void
        
        /** Marks the end of a debug label region. Removes the latest debug label region added by calling [method begin_debug_label_region]. */
        end_debug_label_region(): void
        
        /** Inserts a debug label, this label is reported in any debug message resulting from the OpenXR calls that follows, until any of [method begin_debug_label_region], [method end_debug_label_region], or [method insert_debug_label] is called. */
        insert_debug_label(label_name: string): void
        
        /** Returns `true` if OpenXR is initialized. */
        is_initialized(): boolean
        
        /** Returns `true` if OpenXR is running ([url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/xrBeginSession.html]xrBeginSession[/url] was successfully called and the swapchains were created). */
        is_running(): boolean
        
        /** Sets the reference space used by OpenXR to the given [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrSpace.html]XrSpace[/url] (cast to a `void *`). */
        set_custom_play_space(space: int64): void
        
        /** Returns the play space, which is an [url=https://registry.khronos.org/OpenXR/specs/1.0/man/html/XrSpace.html]XrSpace[/url] cast to an integer. */
        get_play_space(): int64
        
        /** Returns the predicted display timing for the current frame. */
        get_predicted_display_time(): int64
        
        /** Returns the predicted display timing for the next frame. */
        get_next_frame_time(): int64
        
        /** Returns `true` if OpenXR is initialized for rendering with an XR viewport. */
        can_render(): boolean
        
        /** Returns the [RID] corresponding to an `Action` of a matching name, optionally limited to a specified action set. */
        find_action(name: string, action_set: RID): RID
        
        /** Returns the corresponding `XrAction` OpenXR handle for the given action RID. */
        action_get_handle(action: RID): int64
        
        /** Returns the corresponding `XRHandTrackerEXT` handle for the given hand index value. */
        get_hand_tracker(hand_index: int64): int64
        
        /** Registers the given extension as a composition layer provider.  
         *      
         *  **Note:** This cannot be called after the OpenXR session has started. However, it can be called in [method OpenXRExtensionWrapper._on_session_created].  
         */
        register_composition_layer_provider(extension: OpenXRExtensionWrapper): void
        
        /** Unregisters the given extension as a composition layer provider.  
         *      
         *  **Note:** This cannot be called while the OpenXR session is still running.  
         */
        unregister_composition_layer_provider(extension: OpenXRExtensionWrapper): void
        
        /** Registers the given extension as a provider of additional data structures to projections views.  
         *      
         *  **Note:** This cannot be called after the OpenXR session has started. However, it can be called in [method OpenXRExtensionWrapper._on_session_created].  
         */
        register_projection_views_extension(extension: OpenXRExtensionWrapper): void
        
        /** Unregisters the given extension as a provider of additional data structures to projections views.  
         *      
         *  **Note:** This cannot be called while the OpenXR session is still running.  
         */
        unregister_projection_views_extension(extension: OpenXRExtensionWrapper): void
        
        /** Registers the given extension as modifying frame info via the [method OpenXRExtensionWrapper._set_frame_wait_info_and_get_next_pointer], [method OpenXRExtensionWrapper._set_view_locate_info_and_get_next_pointer], or [method OpenXRExtensionWrapper._set_frame_end_info_and_get_next_pointer] virtual methods.  
         *      
         *  **Note:** This cannot be called after the OpenXR session has started. However, it can be called in [method OpenXRExtensionWrapper._on_session_created].  
         */
        register_frame_info_extension(extension: OpenXRExtensionWrapper): void
        
        /** Unregisters the given extension as modifying frame info.  
         *      
         *  **Note:** This cannot be called while the OpenXR session is still running.  
         */
        unregister_frame_info_extension(extension: OpenXRExtensionWrapper): void
        
        /** Returns the near boundary value of the camera frustum.  
         *      
         *  **Note:** This is only accessible in the render thread.  
         */
        get_render_state_z_near(): float64
        
        /** Returns the far boundary value of the camera frustum.  
         *      
         *  **Note:** This is only accessible in the render thread.  
         */
        get_render_state_z_far(): float64
        
        /** Sets the render target of the velocity texture. */
        set_velocity_texture(render_target: RID): void
        
        /** Sets the render target of the velocity depth texture. */
        set_velocity_depth_texture(render_target: RID): void
        
        /** Sets the target size of the velocity and velocity depth textures. */
        set_velocity_target_size(target_size: Vector2i): void
        
        /** Returns an array of supported swapchain formats. */
        get_supported_swapchain_formats(): PackedInt64Array
        
        /** Returns a pointer to a new swapchain created using the provided parameters. */
        openxr_swapchain_create(create_flags: int64, usage_flags: int64, swapchain_format: int64, width: int64, height: int64, sample_count: int64, array_size: int64): int64
        
        /** Destroys the provided swapchain and frees it from memory. */
        openxr_swapchain_free(swapchain: int64): void
        
        /** Returns the `XrSwapchain` handle of the provided swapchain. */
        openxr_swapchain_get_swapchain(swapchain: int64): int64
        
        /** Acquires the image of the provided swapchain. */
        openxr_swapchain_acquire(swapchain: int64): void
        
        /** Returns the RID of the provided swapchain's image. */
        openxr_swapchain_get_image(swapchain: int64): RID
        
        /** Releases the image of the provided swapchain. */
        openxr_swapchain_release(swapchain: int64): void
        
        /** Returns a pointer to the render state's `XrCompositionLayerProjection` struct.  
         *      
         *  **Note:** This method should only be called from the rendering thread.  
         */
        get_projection_layer(): int64
        
        /** Sets the render region to [param render_region], overriding the normal render target's rect. */
        set_render_region(render_region: Rect2i): void
        
        /** If set to `true`, an OpenXR extension is loaded which is capable of emulating the [constant XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND] blend mode. */
        set_emulate_environment_blend_mode_alpha_blend(enabled: boolean): void
        
        /** Returns [enum OpenXRAPIExtension.OpenXRAlphaBlendModeSupport] denoting if [constant XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND] is really supported, emulated or not supported at all. */
        is_environment_blend_mode_alpha_supported(): OpenXRAPIExtension.OpenXRAlphaBlendModeSupport
        
        /** Request the recommended resolution from the OpenXR runtime and update the main swapchain size if it has changed. */
        update_main_swapchain_size(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRAPIExtension;
    }
    namespace OpenXRAction {
        enum ActionType {
            /** This action provides a boolean value. */
            OPENXR_ACTION_BOOL = 0,
            
            /** This action provides a float value between `0.0` and `1.0` for any analog input such as triggers. */
            OPENXR_ACTION_FLOAT = 1,
            
            /** This action provides a [Vector2] value and can be bound to embedded trackpads and joysticks. */
            OPENXR_ACTION_VECTOR2 = 2,
            OPENXR_ACTION_POSE = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRAction extends __NameMapResource {
    }
    /** An OpenXR action.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxraction.html  
     */
    class OpenXRAction extends Resource {
        constructor(identifier?: any)
        /** The localized description of this action. */
        get localized_name(): string
        set localized_name(value: string)
        
        /** The type of action. */
        get action_type(): int64
        set action_type(value: int64)
        
        /** A collections of toplevel paths to which this action can be bound. */
        get toplevel_paths(): PackedStringArray
        set toplevel_paths(value: PackedStringArray | string[])
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRAction;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRActionBindingModifier extends __NameMapOpenXRBindingModifier {
    }
    /** Binding modifier that applies on individual actions related to an interaction profile.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxractionbindingmodifier.html  
     */
    class OpenXRActionBindingModifier extends OpenXRBindingModifier {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRActionBindingModifier;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRActionMap extends __NameMapResource {
    }
    /** Collection of [OpenXRActionSet] and [OpenXRInteractionProfile] resources for the OpenXR module.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxractionmap.html  
     */
    class OpenXRActionMap extends Resource {
        constructor(identifier?: any)
        /** Retrieve the number of actions sets in our action map. */
        get_action_set_count(): int64
        
        /** Retrieve an action set by name. */
        find_action_set(name: string): null | OpenXRActionSet
        
        /** Retrieve the action set at this index. */
        get_action_set(idx: int64): null | OpenXRActionSet
        
        /** Add an action set. */
        add_action_set(action_set: OpenXRActionSet): void
        
        /** Remove an action set. */
        remove_action_set(action_set: OpenXRActionSet): void
        
        /** Retrieve the number of interaction profiles in our action map. */
        get_interaction_profile_count(): int64
        
        /** Find an interaction profile by its name (path). */
        find_interaction_profile(name: string): null | OpenXRInteractionProfile
        
        /** Get the interaction profile at this index. */
        get_interaction_profile(idx: int64): null | OpenXRInteractionProfile
        
        /** Add an interaction profile. */
        add_interaction_profile(interaction_profile: OpenXRInteractionProfile): void
        
        /** Remove an interaction profile. */
        remove_interaction_profile(interaction_profile: OpenXRInteractionProfile): void
        
        /** Setup this action set with our default actions. */
        create_default_action_sets(): void
        
        /** Collection of [OpenXRActionSet]s that are part of this action map. */
        get action_sets(): OpenXRActionSet
        set action_sets(value: OpenXRActionSet)
        
        /** Collection of [OpenXRInteractionProfile]s that are part of this action map. */
        get interaction_profiles(): OpenXRInteractionProfile
        set interaction_profiles(value: OpenXRInteractionProfile)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRActionMap;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRActionSet extends __NameMapResource {
    }
    /** Collection of [OpenXRAction] resources that make up an action set.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxractionset.html  
     */
    class OpenXRActionSet extends Resource {
        constructor(identifier?: any)
        /** Retrieve the number of actions in our action set. */
        get_action_count(): int64
        
        /** Add an action to this action set. */
        add_action(action: OpenXRAction): void
        
        /** Remove an action from this action set. */
        remove_action(action: OpenXRAction): void
        
        /** The localized name of this action set. */
        get localized_name(): string
        set localized_name(value: string)
        
        /** The priority for this action set. */
        get priority(): int64
        set priority(value: int64)
        
        /** Collection of actions for this action set. */
        get actions(): OpenXRAction
        set actions(value: OpenXRAction)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRActionSet;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRAnalogThresholdModifier extends __NameMapOpenXRActionBindingModifier {
    }
    /** The analog threshold binding modifier can modify a float input to a boolean input with specified thresholds.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxranalogthresholdmodifier.html  
     */
    class OpenXRAnalogThresholdModifier extends OpenXRActionBindingModifier {
        constructor(identifier?: any)
        /** When our input value is equal or larger than this value, our output becomes `true`. It stays `true` until it falls under the [member off_threshold] value. */
        get on_threshold(): float64
        set on_threshold(value: float64)
        
        /** When our input value falls below this, our output becomes `false`. */
        get off_threshold(): float64
        set off_threshold(value: float64)
        
        /** Haptic pulse to emit when the user presses the input. */
        get on_haptic(): null | OpenXRHapticBase
        set on_haptic(value: null | OpenXRHapticBase)
        
        /** Haptic pulse to emit when the user releases the input. */
        get off_haptic(): null | OpenXRHapticBase
        set off_haptic(value: null | OpenXRHapticBase)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRAnalogThresholdModifier;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRAnchorTracker extends __NameMapOpenXRSpatialEntityTracker {
    }
    /** Positional tracker for our spatial entity anchor extension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxranchortracker.html  
     */
    class OpenXRAnchorTracker extends OpenXRSpatialEntityTracker {
        constructor(identifier?: any)
        /** Returns `true` if a non-zero UUID is set. */
        has_uuid(): boolean
        
        /** The UUID provided for persistent anchors. */
        get uuid(): string
        set uuid(value: string)
        
        /** Emitted when the UUID for this anchor was changed. */
        readonly uuid_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRAnchorTracker;
    }
    namespace OpenXRAndroidThreadSettingsExtension {
        enum ThreadType {
            /** Hints to the XR runtime that the thread is doing time critical CPU tasks. */
            THREAD_TYPE_APPLICATION_MAIN = 0,
            
            /** Hints to the XR runtime that the thread is doing background CPU tasks. */
            THREAD_TYPE_APPLICATION_WORKER = 1,
            
            /** Hints to the XR runtime that the thread is doing time critical graphics device tasks. */
            THREAD_TYPE_RENDERER_MAIN = 2,
            
            /** Hints to the XR runtime that the thread is doing background graphics device tasks. */
            THREAD_TYPE_RENDERER_WORKER = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRAndroidThreadSettingsExtension extends __NameMapOpenXRExtensionWrapper {
    }
    /** Wraps the [url=https://registry.khronos.org/OpenXR/specs/1.1/html/xrspec.html#XR_KHR_android_thread_settings]XR_KHR_android_thread_settings[/url] extension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrandroidthreadsettingsextension.html  
     */
    class OpenXRAndroidThreadSettingsExtension extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Sets the thread type of the given thread, so that the XR runtime can adjust its scheduling priority accordingly.  
         *  [param thread_id] refers to the OS thread id (ie from `gettid()`). When [param thread_id] is `0`, it will set the thread type of the current thread.  
         *  **NOTE:** The id returned by [method Thread.get_id] is incompatible with [param thread_id].  
         */
        set_application_thread_type(thread_type: OpenXRAndroidThreadSettingsExtension.ThreadType, thread_id?: int64 /* = 0 */): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRAndroidThreadSettingsExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRBindingModifier extends __NameMapResource {
    }
    /** Binding modifier base class.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrbindingmodifier.html  
     */
    class OpenXRBindingModifier extends Resource {
        constructor(identifier?: any)
        /** Return the description of this class that is used for the title bar of the binding modifier editor. */
        /* gdvirtual */ _get_description(): string
        
        /** Returns the data that is sent to OpenXR when submitting the suggested interacting bindings this modifier is a part of.  
         *      
         *  **Note:** This must be data compatible with an `XrBindingModificationBaseHeaderKHR` structure.  
         */
        /* gdvirtual */ _get_ip_modification(): PackedByteArray
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRBindingModifier;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRBindingModifierEditor extends __NameMapPanelContainer {
    }
    /** Binding modifier editor.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrbindingmodifiereditor.html  
     */
    class OpenXRBindingModifierEditor<Map extends NodePathMap = any> extends PanelContainer<Map> {
        constructor(identifier?: any)
        /** Returns the [OpenXRBindingModifier] currently being edited. */
        get_binding_modifier(): null | OpenXRBindingModifier
        
        /** Setup this editor for the provided [param action_map] and [param binding_modifier]. */
        setup(action_map: OpenXRActionMap, binding_modifier: OpenXRBindingModifier): void
        
        /** Signal emitted when the user presses the delete binding modifier button for this modifier. */
        readonly binding_modifier_removed: Signal<(binding_modifier_editor: Object) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRBindingModifierEditor;
    }
    namespace OpenXRCompositionLayer {
        enum Filter {
            /** Perform nearest-neighbor filtering when sampling the texture. */
            FILTER_NEAREST = 0,
            
            /** Perform linear filtering when sampling the texture. */
            FILTER_LINEAR = 1,
            
            /** Perform cubic filtering when sampling the texture. */
            FILTER_CUBIC = 2,
        }
        enum MipmapMode {
            /** Disable mipmapping.  
             *      
             *  **Note:** Mipmapping can only be disabled in the Compatibility renderer.  
             */
            MIPMAP_MODE_DISABLED = 0,
            
            /** Use the mipmap of the nearest resolution. */
            MIPMAP_MODE_NEAREST = 1,
            
            /** Use linear interpolation of the two mipmaps of the nearest resolution. */
            MIPMAP_MODE_LINEAR = 2,
        }
        enum Wrap {
            /** Clamp the texture to its specified border color. */
            WRAP_CLAMP_TO_BORDER = 0,
            
            /** Clamp the texture to its edge color. */
            WRAP_CLAMP_TO_EDGE = 1,
            
            /** Repeat the texture infinitely. */
            WRAP_REPEAT = 2,
            
            /** Repeat the texture infinitely, mirroring it on each repeat. */
            WRAP_MIRRORED_REPEAT = 3,
            
            /** Mirror the texture once and then clamp the texture to its edge color.  
             *      
             *  **Note:** This wrap mode is not available in the Compatibility renderer.  
             */
            WRAP_MIRROR_CLAMP_TO_EDGE = 4,
        }
        enum Swizzle {
            /** Maps a color channel to the value of the red channel. */
            SWIZZLE_RED = 0,
            
            /** Maps a color channel to the value of the green channel. */
            SWIZZLE_GREEN = 1,
            
            /** Maps a color channel to the value of the blue channel. */
            SWIZZLE_BLUE = 2,
            
            /** Maps a color channel to the value of the alpha channel. */
            SWIZZLE_ALPHA = 3,
            
            /** Maps a color channel to the value of zero. */
            SWIZZLE_ZERO = 4,
            
            /** Maps a color channel to the value of one. */
            SWIZZLE_ONE = 5,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRCompositionLayer extends __NameMapNode3D {
    }
    /** The parent class of all OpenXR composition layer nodes.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrcompositionlayer.html  
     */
    class OpenXRCompositionLayer<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Returns a [JavaObject] representing an `android.view.Surface` if [member use_android_surface] is enabled and OpenXR has created the surface. Otherwise, this will return `null`.  
         *      
         *  **Note:** The surface can only be created during an active OpenXR session. So, if [member use_android_surface] is enabled outside of an OpenXR session, it won't be created until a new session fully starts.  
         */
        get_android_surface(): null | JavaObject
        
        /** Returns `true` if the OpenXR runtime natively supports this composition layer type.  
         *      
         *  **Note:** This will only return an accurate result after the OpenXR session has started.  
         */
        is_natively_supported(): boolean
        
        /** Returns UV coordinates where the given ray intersects with the composition layer. [param origin] and [param direction] must be in global space.  
         *  Returns `Vector2(-1.0, -1.0)` if the ray doesn't intersect.  
         */
        intersects_ray(origin: Vector3, direction: Vector3): Vector2
        
        /** The [SubViewport] to render on the composition layer. */
        get layer_viewport(): null | Object
        set layer_viewport(value: null | Object)
        
        /** If enabled, an Android surface will be created (with the dimensions from [member android_surface_size]) which will provide the 2D content for the composition layer, rather than using [member layer_viewport].  
         *  See [method get_android_surface] for information about how to get the surface so that your application can draw to it.  
         *      
         *  **Note:** This will only work in Android builds.  
         */
        get use_android_surface(): boolean
        set use_android_surface(value: boolean)
        
        /** If enabled, the OpenXR swapchain will be created with the `XR_SWAPCHAIN_CREATE_PROTECTED_CONTENT_BIT` flag, which will protect its contents from CPU access.  
         *  When used with an Android Surface, this may allow DRM content to be presented, and will only take effect when the Surface is first created; later changes to this property will have no effect.  
         */
        get protected_content(): boolean
        set protected_content(value: boolean)
        
        /** The size of the Android surface to create if [member use_android_surface] is enabled. */
        get android_surface_size(): Vector2i
        set android_surface_size(value: Vector2i)
        
        /** The sort order for this composition layer. Higher numbers will be shown in front of lower numbers.  
         *      
         *  **Note:** This will have no effect if a fallback mesh is being used.  
         */
        get sort_order(): int64
        set sort_order(value: int64)
        
        /** Enables the blending the layer using its alpha channel.  
         *  Can be combined with [member Viewport.transparent_bg] to give the layer a transparent background.  
         */
        get alpha_blend(): boolean
        set alpha_blend(value: boolean)
        
        /** Enables a technique called "hole punching", which allows putting the composition layer behind the main projection layer (i.e. setting [member sort_order] to a negative value) while "punching a hole" through everything rendered by Godot so that the layer is still visible.  
         *  This can be used to create the illusion that the composition layer exists in the same 3D space as everything rendered by Godot, allowing objects to appear to pass both behind or in front of the composition layer.  
         */
        get enable_hole_punch(): boolean
        set enable_hole_punch(value: boolean)
        
        /** The minification filter of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_min_filter(): int64
        set swapchain_state_min_filter(value: int64)
        
        /** The magnification filter of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_mag_filter(): int64
        set swapchain_state_mag_filter(value: int64)
        
        /** The mipmap mode of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_mipmap_mode(): int64
        set swapchain_state_mipmap_mode(value: int64)
        
        /** The horizontal wrap mode of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_horizontal_wrap(): int64
        set swapchain_state_horizontal_wrap(value: int64)
        
        /** The vertical wrap mode of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_vertical_wrap(): int64
        set swapchain_state_vertical_wrap(value: int64)
        
        /** The swizzle value for the red channel of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_red_swizzle(): int64
        set swapchain_state_red_swizzle(value: int64)
        
        /** The swizzle value for the green channel of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_green_swizzle(): int64
        set swapchain_state_green_swizzle(value: int64)
        
        /** The swizzle value for the blue channel of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_blue_swizzle(): int64
        set swapchain_state_blue_swizzle(value: int64)
        
        /** The swizzle value for the alpha channel of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_alpha_swizzle(): int64
        set swapchain_state_alpha_swizzle(value: int64)
        
        /** The max anisotropy of the swapchain state.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_max_anisotropy(): float64
        set swapchain_state_max_anisotropy(value: float64)
        
        /** The border color of the swapchain state that is used when the wrap mode clamps to the border.  
         *      
         *  **Note:** This property only has an effect on devices that support the OpenXR XR_FB_swapchain_update_state OpenGLES/Vulkan extensions.  
         */
        get swapchain_state_border_color(): Color
        set swapchain_state_border_color(value: Color)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRCompositionLayer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRCompositionLayerCylinder extends __NameMapOpenXRCompositionLayer {
    }
    /** An OpenXR composition layer that is rendered as an internal slice of a cylinder.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrcompositionlayercylinder.html  
     */
    class OpenXRCompositionLayerCylinder<Map extends NodePathMap = any> extends OpenXRCompositionLayer<Map> {
        constructor(identifier?: any)
        /** The radius of the cylinder. */
        get radius(): float64
        set radius(value: float64)
        
        /** The aspect ratio of the slice. Used to set the height relative to the width. */
        get aspect_ratio(): float64
        set aspect_ratio(value: float64)
        
        /** The central angle of the cylinder. Used to set the width. */
        get central_angle(): float64
        set central_angle(value: float64)
        
        /** The number of segments to use in the fallback mesh. */
        get fallback_segments(): int64
        set fallback_segments(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRCompositionLayerCylinder;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRCompositionLayerEquirect extends __NameMapOpenXRCompositionLayer {
    }
    /** An OpenXR composition layer that is rendered as an internal slice of a sphere.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrcompositionlayerequirect.html  
     */
    class OpenXRCompositionLayerEquirect<Map extends NodePathMap = any> extends OpenXRCompositionLayer<Map> {
        constructor(identifier?: any)
        /** The radius of the sphere. */
        get radius(): float64
        set radius(value: float64)
        
        /** The central horizontal angle of the sphere. Used to set the width. */
        get central_horizontal_angle(): float64
        set central_horizontal_angle(value: float64)
        
        /** The upper vertical angle of the sphere. Used (together with [member lower_vertical_angle]) to set the height. */
        get upper_vertical_angle(): float64
        set upper_vertical_angle(value: float64)
        
        /** The lower vertical angle of the sphere. Used (together with [member upper_vertical_angle]) to set the height. */
        get lower_vertical_angle(): float64
        set lower_vertical_angle(value: float64)
        
        /** The number of segments to use in the fallback mesh. */
        get fallback_segments(): int64
        set fallback_segments(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRCompositionLayerEquirect;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRCompositionLayerQuad extends __NameMapOpenXRCompositionLayer {
    }
    /** An OpenXR composition layer that is rendered as a quad.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrcompositionlayerquad.html  
     */
    class OpenXRCompositionLayerQuad<Map extends NodePathMap = any> extends OpenXRCompositionLayer<Map> {
        constructor(identifier?: any)
        /** The dimensions of the quad. */
        get quad_size(): Vector2
        set quad_size(value: Vector2)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRCompositionLayerQuad;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRDpadBindingModifier extends __NameMapOpenXRIPBindingModifier {
    }
    /** The DPad binding modifier converts an axis input to a dpad output.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrdpadbindingmodifier.html  
     */
    class OpenXRDpadBindingModifier extends OpenXRIPBindingModifier {
        constructor(identifier?: any)
        /** Action set for which this dpad binding modifier is active. */
        get action_set(): null | OpenXRActionSet
        set action_set(value: null | OpenXRActionSet)
        
        /** Input path for this dpad binding modifier. */
        get input_path(): string
        set input_path(value: string)
        
        /** When our input value is equal or larger than this value, our dpad in that direction becomes `true`. It stays `true` until it falls under the [member threshold_released] value. */
        get threshold(): float64
        set threshold(value: float64)
        
        /** When our input value falls below this, our output becomes `false`. */
        get threshold_released(): float64
        set threshold_released(value: float64)
        
        /** Center region in which our center position of our dpad return `true`. */
        get center_region(): float64
        set center_region(value: float64)
        
        /** The angle of each wedge that identifies the 4 directions of the emulated dpad. */
        get wedge_angle(): float64
        set wedge_angle(value: float64)
        
        /** If `false`, when the joystick enters a new dpad zone this becomes `true`.  
         *  If `true`, when the joystick remains in active dpad zone, this remains `true` even if we overlap with another zone.  
         */
        get is_sticky(): boolean
        set is_sticky(value: boolean)
        
        /** Haptic pulse to emit when the user presses the input. */
        get on_haptic(): null | OpenXRHapticBase
        set on_haptic(value: null | OpenXRHapticBase)
        
        /** Haptic pulse to emit when the user releases the input. */
        get off_haptic(): null | OpenXRHapticBase
        set off_haptic(value: null | OpenXRHapticBase)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRDpadBindingModifier;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRExtensionWrapper extends __NameMapObject {
    }
    /** Allows implementing OpenXR extensions with GDExtension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrextensionwrapper.html  
     */
    class OpenXRExtensionWrapper extends Object {
        constructor(identifier?: any)
        /** Returns a [Dictionary] of OpenXR extensions related to this extension. [param xr_version] specifies the OpenXR version we're instantiating. This will be zero if the editor requests this list to flag supported features. The [Dictionary] should contain the name of the extension, mapped to a `bool *` cast to an integer:  
         *  - If the `bool *` is a `nullptr` this extension is mandatory.  
         *  - If the `bool *` points to a boolean, the boolean will be updated to `true` if the extension is enabled.  
         */
        /* gdvirtual */ _get_requested_extensions(xr_version: int64): GDictionary
        
        /** Add additional data structures when querying OpenXR system abilities. */
        /* gdvirtual */ _set_system_properties_and_get_next_pointer(next_pointer: int64): int64
        
        /** Add additional data structures when the OpenXR instance is created. [param xr_version] specifies the OpenXR version we're instantiating. */
        /* gdvirtual */ _set_instance_create_info_and_get_next_pointer(xr_version: int64, next_pointer: int64): int64
        
        /** Add additional data structures when the OpenXR session is created. */
        /* gdvirtual */ _set_session_create_and_get_next_pointer(next_pointer: int64): int64
        
        /** Add additional data structures when creating OpenXR swapchains. */
        /* gdvirtual */ _set_swapchain_create_info_and_get_next_pointer(next_pointer: int64): int64
        
        /** Add additional data structures when each hand tracker is created. */
        /* gdvirtual */ _set_hand_joint_locations_and_get_next_pointer(hand_index: int64, next_pointer: int64): int64
        
        /** Add additional data structures to the projection view of the given [param view_index].  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _set_projection_views_and_get_next_pointer(view_index: int64, next_pointer: int64): int64
        
        /** Add additional data structures to `XrFrameWaitInfo`.  
         *  This will only be called if the extension previously registered itself with [method OpenXRAPIExtension.register_frame_info_extension].  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _set_frame_wait_info_and_get_next_pointer(next_pointer: int64): int64
        
        /** Add additional data structures to `XrFrameEndInfo`.  
         *  This will only be called if the extension previously registered itself with [method OpenXRAPIExtension.register_frame_info_extension].  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _set_frame_end_info_and_get_next_pointer(next_pointer: int64): int64
        
        /** Add additional data structures to `XrViewLocateInfo`.  
         *  This will only be called if the extension previously registered itself with [method OpenXRAPIExtension.register_frame_info_extension].  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _set_view_locate_info_and_get_next_pointer(next_pointer: int64): int64
        
        /** Add additional data structures to `XrReferenceSpaceCreateInfo`. */
        /* gdvirtual */ _set_reference_space_create_info_and_get_next_pointer(reference_space_type: int64, next_pointer: int64): int64
        
        /** Called before [method _set_view_configuration_and_get_next_pointer] to allow the extension to reserve data for the given number of views. */
        /* gdvirtual */ _prepare_view_configuration(view_count: int64): void
        
        /** Add additional data structures when querying OpenXR view configuration. */
        /* gdvirtual */ _set_view_configuration_and_get_next_pointer(view: int64, next_pointer: int64): int64
        
        /** Called to allow an extension to print additional information about its view configuration, if applicable. This will only be called if verbose output is enabled. */
        /* gdvirtual */ _print_view_configuration_info(view: int64): void
        
        /** Returns the number of composition layers this extension wrapper provides via [method _get_composition_layer].  
         *  This will only be called if the extension previously registered itself with [method OpenXRAPIExtension.register_composition_layer_provider].  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _get_composition_layer_count(): int64
        
        /** Returns a pointer to an `XrCompositionLayerBaseHeader` struct to provide the given composition layer.  
         *  This will only be called if the extension previously registered itself with [method OpenXRAPIExtension.register_composition_layer_provider].  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _get_composition_layer(index: int64): int64
        
        /** Returns an integer that will be used to sort the given composition layer provided via [method _get_composition_layer]. Lower numbers will move the layer to the front of the list, and higher numbers to the end. The default projection layer has an order of `0`, so layers provided by this method should probably be above or below (but not exactly) `0`.  
         *  This will only be called if the extension previously registered itself with [method OpenXRAPIExtension.register_composition_layer_provider].  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _get_composition_layer_order(index: int64): int64
        
        /** Returns a [PackedStringArray] of positional tracker names that are used within the extension wrapper. */
        /* gdvirtual */ _get_suggested_tracker_names(): PackedStringArray
        
        /** Allows extensions to register additional controller metadata. This function is called even when the OpenXR API is not constructed as the metadata needs to be available to the editor.  
         *  Extensions should also provide metadata regardless of whether they are supported on the host system. The controller data is used to setup action maps for users who may have access to the relevant hardware.  
         */
        /* gdvirtual */ _on_register_metadata(): void
        
        /** Called before the OpenXR instance is created.  
         *      
         *  **Note:** This virtual method will be called on the main thread, however, it will be called  *before*  OpenXR becomes involved in rendering, so it is safe to write to data that will be used by the render thread.  
         */
        /* gdvirtual */ _on_before_instance_created(): void
        
        /** Called right after the OpenXR instance is created.  
         *      
         *  **Note:** This virtual method will be called on the main thread, however, it will be called  *before*  OpenXR becomes involved in rendering, so it is safe to write to data that will be used by the render thread.  
         */
        /* gdvirtual */ _on_instance_created(instance: int64): void
        
        /** Called right before the OpenXR instance is destroyed.  
         *      
         *  **Note:** This virtual method will be called on the main thread, however, it will be called  *after*  OpenXR is done being involved in rendering, so it is safe to write to data that was used by the render thread.  
         */
        /* gdvirtual */ _on_instance_destroyed(): void
        
        /** Called right after the OpenXR session is created.  
         *      
         *  **Note:** This virtual method will be called on the main thread, however, it will be called  *before*  OpenXR becomes involved in rendering, so it is safe to write to data that will be used by the render thread.  
         */
        /* gdvirtual */ _on_session_created(session: int64): void
        
        /** Called as part of the OpenXR process handling. This happens right before general and physics processing steps of the main loop. During this step controller data is queried and made available to game logic. */
        /* gdvirtual */ _on_process(): void
        
        /** Called when OpenXR has performed its action sync. */
        /* gdvirtual */ _on_sync_actions(): void
        
        /** Called right before the XR viewports begin their rendering step.  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _on_pre_render(): void
        
        /** Called right after the main swapchains are (re)created.  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _on_main_swapchains_created(): void
        
        /** Called right before the given viewport is rendered.  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _on_pre_draw_viewport(viewport: RID): void
        
        /** Called right after the given viewport is rendered.  
         *      
         *  **Note:** The draw commands might only be queued at this point, not executed.  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _on_post_draw_viewport(viewport: RID): void
        
        /** Called right before the OpenXR session is destroyed.  
         *      
         *  **Note:** This virtual method will be called on the main thread, however, it will be called  *after*  OpenXR is done being involved in rendering, so it is safe to write to data that was used by the render thread.  
         */
        /* gdvirtual */ _on_session_destroyed(): void
        
        /** Called when the OpenXR session state is changed to idle. */
        /* gdvirtual */ _on_state_idle(): void
        
        /** Called when the OpenXR session state is changed to ready. This means OpenXR is ready to set up the session. */
        /* gdvirtual */ _on_state_ready(): void
        
        /** Called when the OpenXR session state is changed to synchronized. OpenXR also returns to this state when the application loses focus. */
        /* gdvirtual */ _on_state_synchronized(): void
        
        /** Called when the OpenXR session state is changed to visible. This means OpenXR is now ready to receive frames. */
        /* gdvirtual */ _on_state_visible(): void
        
        /** Called when the OpenXR session state is changed to focused. This state is the active state when the game runs. */
        /* gdvirtual */ _on_state_focused(): void
        
        /** Called when the OpenXR session state is changed to stopping. */
        /* gdvirtual */ _on_state_stopping(): void
        
        /** Called when the OpenXR session state is changed to loss pending. */
        /* gdvirtual */ _on_state_loss_pending(): void
        
        /** Called when the OpenXR session state is changed to exiting. */
        /* gdvirtual */ _on_state_exiting(): void
        
        /** Called when there is an OpenXR event to process. When implementing, return `true` if the event was handled, return `false` otherwise. */
        /* gdvirtual */ _on_event_polled(event: int64): boolean
        
        /** Add additional data structures to composition layers created by [OpenXRCompositionLayer].  
         *  [param property_values] contains the values of the properties returned by [method _get_viewport_composition_layer_extension_properties].  
         *  [param layer] is a pointer to an `XrCompositionLayerBaseHeader` struct.  
         *      
         *  **Note:** This virtual method will be called on the render thread. Additionally, the data it returns will be used shortly after this method is called, so it needs to remain valid until the next time [method _on_pre_render] runs.  
         */
        /* gdvirtual */ _set_viewport_composition_layer_and_get_next_pointer(layer: int64, property_values: GDictionary, next_pointer: int64): int64
        
        /** Gets an array of [Dictionary]s that represent properties, just like [method Object._get_property_list], that will be added to [OpenXRCompositionLayer] nodes.  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _get_viewport_composition_layer_extension_properties(): GArray<GDictionary>
        
        /** Gets a [Dictionary] containing the default values for the properties returned by [method _get_viewport_composition_layer_extension_properties]. */
        /* gdvirtual */ _get_viewport_composition_layer_extension_property_defaults(): GDictionary
        
        /** Called when a composition layer created via [OpenXRCompositionLayer] is destroyed.  
         *  [param layer] is a pointer to an `XrCompositionLayerBaseHeader` struct.  
         */
        /* gdvirtual */ _on_viewport_composition_layer_destroyed(layer: int64): void
        
        /** Add additional data structures to Android surface swapchains created by [OpenXRCompositionLayer].  
         *  [param property_values] contains the values of the properties returned by [method _get_viewport_composition_layer_extension_properties].  
         *      
         *  **Note:** This virtual method will be called on the render thread.  
         */
        /* gdvirtual */ _set_android_surface_swapchain_create_info_and_get_next_pointer(property_values: GDictionary, next_pointer: int64): int64
        
        /** Returns the created [OpenXRAPIExtension], which can be used to access the OpenXR API. */
        get_openxr_api(): null | OpenXRAPIExtension
        
        /** Registers the extension. This should happen at core module initialization level.  
         *      
         *  **Note:** This cannot be called once OpenXR has been initialized.  
         */
        register_extension_wrapper(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRExtensionWrapper;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRExtensionWrapperExtension extends __NameMapOpenXRExtensionWrapper {
    }
    /** Allows implementing OpenXR extensions with GDExtension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrextensionwrapperextension.html  
     */
    class OpenXRExtensionWrapperExtension extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRExtensionWrapperExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRFrameSynthesisExtension extends __NameMapOpenXRExtensionWrapper {
    }
    /** The OpenXR Frame synthesis extension allows for advanced reprojection at low(er) framerates.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrframesynthesisextension.html  
     */
    class OpenXRFrameSynthesisExtension extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if frame synthesis is enabled in the project settings and the current XR runtime supports frame synthesis. The value returned will only be valid once OpenXR has been initialized. */
        is_available(): boolean
        
        /** Queues the next frame to be skipped when supplying motion vector and depth data. Call this after teleporting your player or a similar action has moved the player to prevent incorrect reprojection results due to this movement. */
        skip_next_frame(): void
        
        /** Enable frame synthesis. When `true` motion vector and depth data is provided to the XR runtime. */
        get enabled(): boolean
        set enabled(value: boolean)
        
        /** If `true` this informs the XR runtime we will be providing frames at a greatly reduced rate. Enable this when you expect your application to run at low framerates and wish to inject multiple reprojected frames. */
        get relax_frame_interval(): boolean
        set relax_frame_interval(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRFrameSynthesisExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRFutureExtension extends __NameMapOpenXRExtensionWrapper {
    }
    /** The OpenXR Future extension allows for asynchronous APIs to be used.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrfutureextension.html  
     */
    class OpenXRFutureExtension extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if futures are available in the OpenXR runtime used. This function will only return a usable result after OpenXR has been initialized. */
        is_active(): boolean
        
        /** Register an OpenXR Future object so we monitor for completion. [param future] must be an `XrFutureEXT` value previously returned by an API that started an asynchronous function.  
         *  You can optionally specify [param on_success], it will be invoked on successful completion of the future.  
         *  Or you can use the returned [OpenXRFutureResult] object to `await` its [signal OpenXRFutureResult.completed] signal.  
         *    
         */
        register_future(future: int64, on_success?: Callable /* = new Callable() */): null | OpenXRFutureResult
        
        /** Cancels an in-progress future. [param future] must be an `XrFutureEXT` value previously returned by an API that started an asynchronous function. */
        cancel_future(future: int64): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRFutureExtension;
    }
    namespace OpenXRFutureResult {
        enum ResultStatus {
            /** The asynchronous function is running. */
            RESULT_RUNNING = 0,
            
            /** The asynchronous function has finished. */
            RESULT_FINISHED = 1,
            
            /** The asynchronous function has been cancelled. */
            RESULT_CANCELLED = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRFutureResult extends __NameMapRefCounted {
    }
    /** Result object tracking the asynchronous result of an OpenXR Future object.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrfutureresult.html  
     */
    class OpenXRFutureResult extends RefCounted {
        constructor(identifier?: any)
        /** Returns the status of this result. */
        get_status(): OpenXRFutureResult.ResultStatus
        
        /** Return the `XrFutureEXT` value this result relates to. */
        get_future(): int64
        
        /** Cancel this future, this will interrupt and stop the asynchronous function. */
        cancel_future(): void
        
        /** Stores the result value we expose to the user.  
         *      
         *  **Note:** This method should only be called by an OpenXR extension that implements an asynchronous function.  
         */
        set_result_value(result_value: any): void
        
        /** Returns the result value of our asynchronous function (if set by the extension). The type of this result value depends on the function being called. Consult the documentation of the relevant function. */
        get_result_value(): any
        
        /** Emitted when the asynchronous function is finished or has been cancelled. */
        readonly completed: Signal<(result: OpenXRFutureResult) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRFutureResult;
    }
    namespace OpenXRHand {
        enum Hands {
            /** Tracking the player's left hand. */
            HAND_LEFT = 0,
            
            /** Tracking the player's right hand. */
            HAND_RIGHT = 1,
            
            /** Maximum supported hands. */
            HAND_MAX = 2,
        }
        enum MotionRange {
            /** When player grips, hand skeleton will form a full fist. */
            MOTION_RANGE_UNOBSTRUCTED = 0,
            
            /** When player grips, hand skeleton conforms to the controller the player is holding. */
            MOTION_RANGE_CONFORM_TO_CONTROLLER = 1,
            
            /** Maximum supported motion ranges. */
            MOTION_RANGE_MAX = 2,
        }
        enum SkeletonRig {
            /** An OpenXR compliant skeleton. */
            SKELETON_RIG_OPENXR = 0,
            
            /** A [SkeletonProfileHumanoid] compliant skeleton. */
            SKELETON_RIG_HUMANOID = 1,
            
            /** Maximum supported hands. */
            SKELETON_RIG_MAX = 2,
        }
        enum BoneUpdate {
            /** The skeletons bones are fully updated (both position and rotation) to match the tracked bones. */
            BONE_UPDATE_FULL = 0,
            
            /** The skeletons bones are only rotated to align with the tracked bones, preserving bone length. */
            BONE_UPDATE_ROTATION_ONLY = 1,
            
            /** Maximum supported bone update mode. */
            BONE_UPDATE_MAX = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRHand extends __NameMapNode3D {
    }
    /** Node supporting hand and finger tracking in OpenXR.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrhand.html  
     */
    class OpenXRHand<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Specifies whether this node tracks the left or right hand of the player. */
        get hand(): int64
        set hand(value: int64)
        
        /** Set the motion range (if supported) limiting the hand motion. */
        get motion_range(): int64
        set motion_range(value: int64)
        
        /** Set a [Skeleton3D] node for which the pose positions will be updated. */
        get hand_skeleton(): NodePath
        set hand_skeleton(value: NodePath | string)
        
        /** Set the type of skeleton rig the [member hand_skeleton] is compliant with. */
        get skeleton_rig(): int64
        set skeleton_rig(value: int64)
        
        /** Specify the type of updates to perform on the bone. */
        get bone_update(): int64
        set bone_update(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRHand;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRHapticBase extends __NameMapResource {
    }
    /** OpenXR Haptic feedback base class.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrhapticbase.html  
     */
    class OpenXRHapticBase extends Resource {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRHapticBase;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRHapticVibration extends __NameMapOpenXRHapticBase {
    }
    /** Vibration haptic feedback.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrhapticvibration.html  
     */
    class OpenXRHapticVibration extends OpenXRHapticBase {
        constructor(identifier?: any)
        /** The duration of the pulse in nanoseconds. Use `-1` for a minimum duration pulse for the current XR runtime. */
        get duration(): int64
        set duration(value: int64)
        
        /** The frequency of the pulse in Hz. `0.0` will let the XR runtime chose an optimal frequency for the device used. */
        get frequency(): float64
        set frequency(value: float64)
        
        /** The amplitude of the pulse between `0.0` and `1.0`. */
        get amplitude(): float64
        set amplitude(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRHapticVibration;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRIPBinding extends __NameMapResource {
    }
    /** Defines a binding between an [OpenXRAction] and an XR input or output.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxripbinding.html  
     */
    class OpenXRIPBinding extends Resource {
        constructor(identifier?: any)
        /** Get the number of binding modifiers for this binding. */
        get_binding_modifier_count(): int64
        
        /** Get the [OpenXRBindingModifier] at this index. */
        get_binding_modifier(index: int64): null | OpenXRActionBindingModifier
        
        /** Get the number of input/output paths in this binding. */
        get_path_count(): int64
        
        /** Returns `true` if this input/output path is part of this binding. */
        has_path(path: string): boolean
        
        /** Add an input/output path to this binding. */
        add_path(path: string): void
        
        /** Removes this input/output path from this binding. */
        remove_path(path: string): void
        
        /** [OpenXRAction] that is bound to [member binding_path]. */
        get action(): null | OpenXRAction
        set action(value: null | OpenXRAction)
        
        /** Binding path that defines the input or output bound to [member action].  
         *      
         *  **Note:** Binding paths are suggestions, an XR runtime may choose to bind the action to a different input or output emulating this input or output.  
         */
        get binding_path(): string
        set binding_path(value: string)
        
        /** Binding modifiers for this binding. */
        get binding_modifiers(): OpenXRActionBindingModifier
        set binding_modifiers(value: OpenXRActionBindingModifier)
        
        /** Paths that define the inputs or outputs bound on the device. */
        get paths(): PackedStringArray
        set paths(value: PackedStringArray | string[])
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRIPBinding;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRIPBindingModifier extends __NameMapOpenXRBindingModifier {
    }
    /** Binding modifier that applies directly on an interaction profile.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxripbindingmodifier.html  
     */
    class OpenXRIPBindingModifier extends OpenXRBindingModifier {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRIPBindingModifier;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRInteractionProfile extends __NameMapResource {
    }
    /** Suggested bindings object for OpenXR.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrinteractionprofile.html  
     */
    class OpenXRInteractionProfile extends Resource {
        constructor(identifier?: any)
        /** Get the number of bindings in this interaction profile. */
        get_binding_count(): int64
        
        /** Retrieve the binding at this index. */
        get_binding(index: int64): null | OpenXRIPBinding
        
        /** Get the number of binding modifiers in this interaction profile. */
        get_binding_modifier_count(): int64
        
        /** Get the [OpenXRBindingModifier] at this index. */
        get_binding_modifier(index: int64): null | OpenXRIPBindingModifier
        
        /** The interaction profile path identifying the XR device. */
        get interaction_profile_path(): string
        set interaction_profile_path(value: string)
        
        /** Action bindings for this interaction profile. */
        get bindings(): OpenXRIPBinding
        set bindings(value: OpenXRIPBinding)
        
        /** Binding modifiers for this interaction profile. */
        get binding_modifiers(): OpenXRIPBindingModifier
        set binding_modifiers(value: OpenXRIPBindingModifier)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRInteractionProfile;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRInteractionProfileEditor extends __NameMapOpenXRInteractionProfileEditorBase {
    }
    /** Default OpenXR interaction profile editor.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrinteractionprofileeditor.html  
     */
    class OpenXRInteractionProfileEditor<Map extends NodePathMap = any> extends OpenXRInteractionProfileEditorBase<Map> {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRInteractionProfileEditor;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRInteractionProfileEditorBase extends __NameMapHBoxContainer {
    }
    /** Base class for editing interaction profiles.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrinteractionprofileeditorbase.html  
     */
    class OpenXRInteractionProfileEditorBase<Map extends NodePathMap = any> extends HBoxContainer<Map> {
        constructor(identifier?: any)
        /** Setup this editor for the provided [param action_map] and [param interaction_profile]. */
        setup(action_map: OpenXRActionMap, interaction_profile: OpenXRInteractionProfile): void
        _add_binding(action: string, path: string): void
        _remove_binding(action: string, path: string): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRInteractionProfileEditorBase;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRInteractionProfileMetadata extends __NameMapObject {
    }
    /** Meta class registering supported devices in OpenXR.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrinteractionprofilemetadata.html  
     */
    class OpenXRInteractionProfileMetadata extends Object {
        constructor(identifier?: any)
        /** Allows for renaming old interaction profile paths to new paths in order to load and process older action maps. */
        register_profile_rename(old_name: string, new_name: string): void
        
        /** Allows for renaming old input/output paths to new paths in order to load and process older action maps. */
        register_path_rename(old_name: string, new_name: string): void
        
        /** Registers a top level path to which profiles can be bound. For instance `/user/hand/left` refers to the bind point for the player's left hand. Extensions can register additional top level paths, for instance a haptic vest extension might register `/user/body/vest`.  
         *  [param display_name] is the name shown to the user. [param openxr_path] is the top level path being registered. [param openxr_extension_names] is optional and ensures the top level path is only used if the specified extension is available/enabled.  
         *  When a top level path ends up being bound by OpenXR, an [XRPositionalTracker] is instantiated to manage the state of the device.  
         */
        register_top_level_path(display_name: string, openxr_path: string, openxr_extension_names: string): void
        
        /** Registers an interaction profile using its OpenXR designation (e.g. `/interaction_profiles/khr/simple_controller` is the profile for OpenXR's simple controller profile).  
         *  [param display_name] is the description shown to the user. [param openxr_path] is the interaction profile path being registered. [param openxr_extension_names] optionally restricts this profile to the given extension being enabled/available. If the extension is not available, the profile and all related entries used in an action map are filtered out.  
         */
        register_interaction_profile(display_name: string, openxr_path: string, openxr_extension_names: string): void
        
        /** Registers an input/output path for the given [param interaction_profile]. The profile should previously have been registered using [method register_interaction_profile]. [param display_name] is the description shown to the user. [param toplevel_path] specifies the bind path this input/output can be bound to (e.g. `/user/hand/left` or `/user/hand/right`). [param openxr_path] is the action input/output being registered (e.g. `/user/hand/left/input/aim/pose`). [param openxr_extension_names] restricts this input/output to an enabled/available extension, this doesn't need to repeat the extension on the profile but relates to overlapping extension (e.g. `XR_EXT_palm_pose` that introduces `…/input/palm_ext/pose` input paths). [param action_type] defines the type of input or output provided by OpenXR. */
        register_io_path(interaction_profile: string, display_name: string, toplevel_path: string, openxr_path: string, openxr_extension_names: string, action_type: OpenXRAction.ActionType): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRInteractionProfileMetadata;
    }
    namespace OpenXRInterface {
        enum SessionState {
            /** The state of the session is unknown, we haven't tried setting up OpenXR yet. */
            SESSION_STATE_UNKNOWN = 0,
            
            /** The initial state after the OpenXR session is created or after the session is destroyed. */
            SESSION_STATE_IDLE = 1,
            
            /** OpenXR is ready to begin our session. [signal session_begun] is emitted when we change to this state. */
            SESSION_STATE_READY = 2,
            
            /** The application has synched its frame loop with the runtime but we're not rendering anything. [signal session_synchronized] is emitted when we change to this state. */
            SESSION_STATE_SYNCHRONIZED = 3,
            
            /** The application has synched its frame loop with the runtime and we're rendering output to the user, however we receive no user input. [signal session_visible] is emitted when we change to this state.  
             *      
             *  **Note:** This is the current state just before we get the focused state, whenever the user opens a system menu, switches to another application, or takes off their headset.  
             */
            SESSION_STATE_VISIBLE = 4,
            
            /** The application has synched its frame loop with the runtime, we're rendering output to the user and we're receiving XR input. [signal session_focussed] is emitted when we change to this state.  
             *      
             *  **Note:** This is the state OpenXR will be in when the user can fully interact with your game.  
             */
            SESSION_STATE_FOCUSED = 5,
            
            /** Our session is being stopped. [signal session_stopping] is emitted when we change to this state. */
            SESSION_STATE_STOPPING = 6,
            
            /** The session is about to be lost. [signal session_loss_pending] is emitted when we change to this state. */
            SESSION_STATE_LOSS_PENDING = 7,
            
            /** The OpenXR instance is about to be destroyed and we're exiting. [signal instance_exiting] is emitted when we change to this state. */
            SESSION_STATE_EXITING = 8,
        }
        enum Hand {
            /** Left hand. */
            HAND_LEFT = 0,
            
            /** Right hand. */
            HAND_RIGHT = 1,
            
            /** Maximum value for the hand enum. */
            HAND_MAX = 2,
        }
        enum HandMotionRange {
            /** Full hand range, if user closes their hands, we make a full fist. */
            HAND_MOTION_RANGE_UNOBSTRUCTED = 0,
            
            /** Conform to controller, if user closes their hands, the tracked data conforms to the shape of the controller. */
            HAND_MOTION_RANGE_CONFORM_TO_CONTROLLER = 1,
            
            /** Maximum value for the motion range enum. */
            HAND_MOTION_RANGE_MAX = 2,
        }
        enum HandTrackedSource {
            /** The source of hand tracking data is unknown (the extension is likely unsupported). */
            HAND_TRACKED_SOURCE_UNKNOWN = 0,
            
            /** The source of hand tracking is unobstructed, this means that an accurate method of hand tracking is used, e.g. optical hand tracking, data gloves, etc. */
            HAND_TRACKED_SOURCE_UNOBSTRUCTED = 1,
            
            /** The source of hand tracking is a controller, bone positions are inferred from controller inputs. */
            HAND_TRACKED_SOURCE_CONTROLLER = 2,
            
            /** Represents the size of the [enum HandTrackedSource] enum. */
            HAND_TRACKED_SOURCE_MAX = 3,
        }
        enum HandJoints {
            /** Palm joint. */
            HAND_JOINT_PALM = 0,
            
            /** Wrist joint. */
            HAND_JOINT_WRIST = 1,
            
            /** Thumb metacarpal joint. */
            HAND_JOINT_THUMB_METACARPAL = 2,
            
            /** Thumb proximal joint. */
            HAND_JOINT_THUMB_PROXIMAL = 3,
            
            /** Thumb distal joint. */
            HAND_JOINT_THUMB_DISTAL = 4,
            
            /** Thumb tip joint. */
            HAND_JOINT_THUMB_TIP = 5,
            
            /** Index finger metacarpal joint. */
            HAND_JOINT_INDEX_METACARPAL = 6,
            
            /** Index finger phalanx proximal joint. */
            HAND_JOINT_INDEX_PROXIMAL = 7,
            
            /** Index finger phalanx intermediate joint. */
            HAND_JOINT_INDEX_INTERMEDIATE = 8,
            
            /** Index finger phalanx distal joint. */
            HAND_JOINT_INDEX_DISTAL = 9,
            
            /** Index finger tip joint. */
            HAND_JOINT_INDEX_TIP = 10,
            
            /** Middle finger metacarpal joint. */
            HAND_JOINT_MIDDLE_METACARPAL = 11,
            
            /** Middle finger phalanx proximal joint. */
            HAND_JOINT_MIDDLE_PROXIMAL = 12,
            
            /** Middle finger phalanx intermediate joint. */
            HAND_JOINT_MIDDLE_INTERMEDIATE = 13,
            
            /** Middle finger phalanx distal joint. */
            HAND_JOINT_MIDDLE_DISTAL = 14,
            
            /** Middle finger tip joint. */
            HAND_JOINT_MIDDLE_TIP = 15,
            
            /** Ring finger metacarpal joint. */
            HAND_JOINT_RING_METACARPAL = 16,
            
            /** Ring finger phalanx proximal joint. */
            HAND_JOINT_RING_PROXIMAL = 17,
            
            /** Ring finger phalanx intermediate joint. */
            HAND_JOINT_RING_INTERMEDIATE = 18,
            
            /** Ring finger phalanx distal joint. */
            HAND_JOINT_RING_DISTAL = 19,
            
            /** Ring finger tip joint. */
            HAND_JOINT_RING_TIP = 20,
            
            /** Pinky finger metacarpal joint. */
            HAND_JOINT_LITTLE_METACARPAL = 21,
            
            /** Pinky finger phalanx proximal joint. */
            HAND_JOINT_LITTLE_PROXIMAL = 22,
            
            /** Pinky finger phalanx intermediate joint. */
            HAND_JOINT_LITTLE_INTERMEDIATE = 23,
            
            /** Pinky finger phalanx distal joint. */
            HAND_JOINT_LITTLE_DISTAL = 24,
            
            /** Pinky finger tip joint. */
            HAND_JOINT_LITTLE_TIP = 25,
            
            /** Represents the size of the [enum HandJoints] enum. */
            HAND_JOINT_MAX = 26,
        }
        enum PerfSettingsLevel {
            /** The application has entered a non-XR section (head-locked / static screen), during which power savings are to be prioritized. */
            PERF_SETTINGS_LEVEL_POWER_SAVINGS = 0,
            
            /** The application has entered a low and stable complexity section, during which reducing power is more important than occasional late rendering frames. */
            PERF_SETTINGS_LEVEL_SUSTAINED_LOW = 1,
            
            /** The application has entered a high or dynamic complexity section, during which the XR Runtime strives for consistent XR compositing and frame rendering within a thermally sustainable range. */
            PERF_SETTINGS_LEVEL_SUSTAINED_HIGH = 2,
            
            /** The application has entered a section with very high complexity, during which the XR Runtime is allowed to step up beyond the thermally sustainable range. */
            PERF_SETTINGS_LEVEL_BOOST = 3,
        }
        enum PerfSettingsSubDomain {
            /** The compositing performance within the runtime has reached a new level. */
            PERF_SETTINGS_SUB_DOMAIN_COMPOSITING = 0,
            
            /** The application rendering performance has reached a new level. */
            PERF_SETTINGS_SUB_DOMAIN_RENDERING = 1,
            
            /** The temperature of the device has reached a new level. */
            PERF_SETTINGS_SUB_DOMAIN_THERMAL = 2,
        }
        enum PerfSettingsNotificationLevel {
            /** The sub-domain has reached a level where no further actions other than currently applied are necessary. */
            PERF_SETTINGS_NOTIF_LEVEL_NORMAL = 0,
            
            /** The sub-domain has reached an early warning level where the application should start proactive mitigation actions. */
            PERF_SETTINGS_NOTIF_LEVEL_WARNING = 1,
            
            /** The sub-domain has reached a critical level where the application should start drastic mitigation actions. */
            PERF_SETTINGS_NOTIF_LEVEL_IMPAIRED = 2,
        }
        enum HandJointFlags {
            /** No flags are set. */
            HAND_JOINT_NONE = 0,
            
            /** If set, the orientation data is valid, otherwise, the orientation data is unreliable and should not be used. */
            HAND_JOINT_ORIENTATION_VALID = 1,
            
            /** If set, the orientation data comes from tracking data, otherwise, the orientation data contains predicted data. */
            HAND_JOINT_ORIENTATION_TRACKED = 2,
            
            /** If set, the positional data is valid, otherwise, the positional data is unreliable and should not be used. */
            HAND_JOINT_POSITION_VALID = 4,
            
            /** If set, the positional data comes from tracking data, otherwise, the positional data contains predicted data. */
            HAND_JOINT_POSITION_TRACKED = 8,
            
            /** If set, our linear velocity data is valid, otherwise, the linear velocity data is unreliable and should not be used. */
            HAND_JOINT_LINEAR_VELOCITY_VALID = 16,
            
            /** If set, our angular velocity data is valid, otherwise, the angular velocity data is unreliable and should not be used. */
            HAND_JOINT_ANGULAR_VELOCITY_VALID = 32,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRInterface extends __NameMapXRInterface {
    }
    /** Our OpenXR interface.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrinterface.html  
     */
    class OpenXRInterface extends XRInterface {
        constructor(identifier?: any)
        /** Returns the current state of our OpenXR session. */
        get_session_state(): OpenXRInterface.SessionState
        
        /** Returns `true` if OpenXR's foveation extension is supported. The interface must be initialized before this returns a valid value.  
         *      
         *  **Note:** When using the Vulkan rendering driver, [member Viewport.vrs_mode] must be set to [constant Viewport.VRS_XR] to support foveation.  
         */
        is_foveation_supported(): boolean
        
        /** Returns `true` if the given action set is active. */
        is_action_set_active(name: string): boolean
        
        /** Sets the given action set as active or inactive. */
        set_action_set_active(name: string, active: boolean): void
        
        /** Returns a list of action sets registered with Godot (loaded from the action map at runtime). */
        get_action_sets(): GArray
        
        /** Returns a list of display refresh rates supported by the current HMD. Only returned if this feature is supported by the OpenXR runtime and after the interface has been initialized. */
        get_available_display_refresh_rates(): GArray
        
        /** If handtracking is enabled and motion range is supported, sets the currently configured motion range for [param hand] to [param motion_range]. */
        set_motion_range(hand: OpenXRInterface.Hand, motion_range: OpenXRInterface.HandMotionRange): void
        
        /** If handtracking is enabled and motion range is supported, gets the currently configured motion range for [param hand]. */
        get_motion_range(hand: OpenXRInterface.Hand): OpenXRInterface.HandMotionRange
        
        /** If handtracking is enabled and hand tracking source is supported, gets the source of the hand tracking data for [param hand]. */
        get_hand_tracking_source(hand: OpenXRInterface.Hand): OpenXRInterface.HandTrackedSource
        
        /** If handtracking is enabled, returns flags that inform us of the validity of the tracking data. */
        get_hand_joint_flags(hand: OpenXRInterface.Hand, joint: OpenXRInterface.HandJoints): OpenXRInterface.HandJointFlags
        
        /** If handtracking is enabled, returns the rotation of a joint ([param joint]) of a hand ([param hand]) as provided by OpenXR. */
        get_hand_joint_rotation(hand: OpenXRInterface.Hand, joint: OpenXRInterface.HandJoints): Quaternion
        
        /** If handtracking is enabled, returns the position of a joint ([param joint]) of a hand ([param hand]) as provided by OpenXR. This is relative to [XROrigin3D] without worldscale applied! */
        get_hand_joint_position(hand: OpenXRInterface.Hand, joint: OpenXRInterface.HandJoints): Vector3
        
        /** If handtracking is enabled, returns the radius of a joint ([param joint]) of a hand ([param hand]) as provided by OpenXR. This is without worldscale applied! */
        get_hand_joint_radius(hand: OpenXRInterface.Hand, joint: OpenXRInterface.HandJoints): float64
        
        /** If handtracking is enabled, returns the linear velocity of a joint ([param joint]) of a hand ([param hand]) as provided by OpenXR. This is relative to [XROrigin3D] without worldscale applied! */
        get_hand_joint_linear_velocity(hand: OpenXRInterface.Hand, joint: OpenXRInterface.HandJoints): Vector3
        
        /** If handtracking is enabled, returns the angular velocity of a joint ([param joint]) of a hand ([param hand]) as provided by OpenXR. This is relative to [XROrigin3D]! */
        get_hand_joint_angular_velocity(hand: OpenXRInterface.Hand, joint: OpenXRInterface.HandJoints): Vector3
        
        /** Returns `true` if OpenXR's hand tracking is supported and enabled.  
         *      
         *  **Note:** This only returns a valid value after OpenXR has been initialized.  
         */
        is_hand_tracking_supported(): boolean
        
        /** Returns `true` if OpenXR's hand interaction profile is supported and enabled.  
         *      
         *  **Note:** This only returns a valid value after OpenXR has been initialized.  
         */
        is_hand_interaction_supported(): boolean
        
        /** Returns the capabilities of the eye gaze interaction extension.  
         *      
         *  **Note:** This only returns a valid value after OpenXR has been initialized.  
         */
        is_eye_gaze_interaction_supported(): boolean
        
        /** Sets the CPU performance level of the OpenXR device. */
        set_cpu_level(level: OpenXRInterface.PerfSettingsLevel): void
        
        /** Sets the GPU performance level of the OpenXR device. */
        set_gpu_level(level: OpenXRInterface.PerfSettingsLevel): void
        
        /** The display refresh rate for the current HMD. Only functional if this feature is supported by the OpenXR runtime and after the interface has been initialized. */
        get display_refresh_rate(): float64
        set display_refresh_rate(value: float64)
        
        /** The render size multiplier for the current HMD. Must be set before the interface has been initialized. */
        get render_target_size_multiplier(): float64
        set render_target_size_multiplier(value: float64)
        
        /** The foveation level, from `0` (off) to `3` (high). The interface must be initialized before this is accessible.  
         *      
         *  **Note:** Only works on the Compatibility renderer.  
         */
        get foveation_level(): int64
        set foveation_level(value: int64)
        
        /** If `true`, enables dynamic foveation adjustment. The interface must be initialized before this is accessible. If enabled, foveation will automatically be adjusted between low and [member foveation_level].  
         *      
         *  **Note:** Only works on the Compatibility renderer.  
         */
        get foveation_dynamic(): boolean
        set foveation_dynamic(value: boolean)
        
        /** The minimum radius around the focal point where full quality is guaranteed if VRS is used as a percentage of screen size.  
         *      
         *  **Note:** Mobile and Forward+ renderers only. Requires [member Viewport.vrs_mode] to be set to [constant Viewport.VRS_XR].  
         */
        get vrs_min_radius(): float64
        set vrs_min_radius(value: float64)
        
        /** The strength used to calculate the VRS density map. The greater this value, the more noticeable VRS is. This improves performance at the cost of quality.  
         *      
         *  **Note:** Mobile and Forward+ renderers only. Requires [member Viewport.vrs_mode] to be set to [constant Viewport.VRS_XR].  
         */
        get vrs_strength(): float64
        set vrs_strength(value: float64)
        
        /** Informs our OpenXR session has been started. */
        readonly session_begun: Signal<() => void>
        
        /** Informs our OpenXR session is stopping. */
        readonly session_stopping: Signal<() => void>
        
        /** Informs our OpenXR session has been synchronized. */
        readonly session_synchronized: Signal<() => void>
        
        /** Informs our OpenXR session now has focus, for example output is sent to the HMD and we're receiving XR input. */
        readonly session_focussed: Signal<() => void>
        
        /** Informs our OpenXR session is now visible, for example output is sent to the HMD but we don't receive XR input. */
        readonly session_visible: Signal<() => void>
        
        /** Informs our OpenXR session is in the process of being lost. */
        readonly session_loss_pending: Signal<() => void>
        
        /** Informs our OpenXR instance is exiting. */
        readonly instance_exiting: Signal<() => void>
        
        /** Informs the user queued a recenter of the player position. */
        readonly pose_recentered: Signal<() => void>
        
        /** Informs the user the HMD refresh rate has changed.  
         *      
         *  **Note:** Only emitted if XR runtime supports the refresh rate extension.  
         */
        readonly refresh_rate_changed: Signal<(refresh_rate: float64) => void>
        
        /** Informs the device CPU performance level has changed in the specified subdomain. */
        readonly cpu_level_changed: Signal<(sub_domain: int64, from_level: int64, to_level: int64) => void>
        
        /** Informs the device GPU performance level has changed in the specified subdomain. */
        readonly gpu_level_changed: Signal<(sub_domain: int64, from_level: int64, to_level: int64) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRInterface;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRMarkerTracker extends __NameMapOpenXRSpatialEntityTracker {
    }
    /** Spatial entity tracker for our spatial entity marker tracking extension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrmarkertracker.html  
     */
    class OpenXRMarkerTracker extends OpenXRSpatialEntityTracker {
        constructor(identifier?: any)
        /** Sets the marker data for this marker.  
         *      
         *  **Note:** This should only be set by marker discovery logic.  
         */
        set_marker_data(marker_data: any): void
        
        /** Returns the marker data for this marker. This can return a [String] or [PackedByteArray]. Only applicable to QR Code based markers. */
        get_marker_data(): any
        
        /** The bounds size for this marker. */
        get bounds_size(): int64
        set bounds_size(value: int64)
        
        /** The type of marker. */
        get marker_type(): int64
        set marker_type(value: int64)
        
        /** The marker ID for this marker, this is only returned for Aruco and April Tag markers. Call [method get_marker_data] for QRCode markers. */
        get marker_id(): int64
        set marker_id(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRMarkerTracker;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRPlaneTracker extends __NameMapOpenXRSpatialEntityTracker {
    }
    /** Spatial entity tracker for our spatial entity plane tracking extension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrplanetracker.html  
     */
    class OpenXRPlaneTracker extends OpenXRSpatialEntityTracker {
        constructor(identifier?: any)
        /** Sets the mesh data for this plane. You should only call this if you are handling your own discovery logic. */
        set_mesh_data(origin: Transform3D, vertices: PackedVector2Array | Vector2[], indices?: PackedInt32Array | int32[] /* = [] */): void
        
        /** Clears the mesh data for this tracker. You should only call this if you are handling your own discovery logic. */
        clear_mesh_data(): void
        
        /** Gets the transform by which to offset the mesh and collision shape from our pose to display these correctly. */
        get_mesh_offset(): Transform3D
        
        /** Gets a mesh created from either the mesh data or from our bounding size for this plane. */
        get_mesh(): null | Mesh
        
        /** Gets a collision shape built either from the mesh data or from our bounding size for this plane. */
        get_shape(thickness?: float64 /* = 0.01 */): null | Shape3D
        
        /** The bounding size of the plane. This is a 2D size. */
        get bounds_size(): int64
        set bounds_size(value: int64)
        
        /** The main alignment in space of this plane. */
        get plane_alignment(): int64
        set plane_alignment(value: int64)
        
        /** The semantic label for this plane. */
        get plane_label(): string
        set plane_label(value: string)
        
        /** Emitted when our mesh data has changed the mesh instance and collision needs to be updated. */
        readonly mesh_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRPlaneTracker;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRRenderModel extends __NameMapNode3D {
    }
    /** This node will display an OpenXR render model.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrrendermodel.html  
     */
    class OpenXRRenderModel<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Returns the top level path related to this render model. */
        get_top_level_path(): string
        
        /** The render model RID for the render model to load, as returned by [method OpenXRRenderModelExtension.render_model_create] or [method OpenXRRenderModelExtension.render_model_get_all]. */
        get render_model(): RID
        set render_model(value: RID)
        
        /** Emitted when the top level path of this render model has changed. */
        readonly render_model_top_level_path_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRRenderModel;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRRenderModelExtension extends __NameMapOpenXRExtensionWrapper {
    }
    /** This class implements the OpenXR Render Model Extension.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrrendermodelextension.html  
     */
    class OpenXRRenderModelExtension extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if OpenXR's render model extension is supported and enabled.  
         *      
         *  **Note:** This only returns a valid value after OpenXR has been initialized.  
         */
        is_active(): boolean
        
        /** Creates a render model object within OpenXR using a render model id.  
         *      
         *  **Note:** This function is exposed for dependent OpenXR extensions that provide render model ids to be used with the render model extension.  
         */
        render_model_create(render_model_id: int64): RID
        
        /** Destroys a render model object within OpenXR that was previously created with [method render_model_create].  
         *      
         *  **Note:** This function is exposed for dependent OpenXR extensions that provide render model ids to be used with the render model extension.  
         */
        render_model_destroy(render_model: RID): void
        
        /** Returns an array of all currently active render models registered with this extension. */
        render_model_get_all(): GArray<RID>
        
        /** Returns an instance of a subscene that contains all [MeshInstance3D] nodes that allow you to visualize the render model. */
        render_model_new_scene_instance(render_model: RID): null | Node3D
        
        /** Returns a list of active subaction paths for this [param render_model].  
         *      
         *  **Note:** If different devices are bound to your actions than available in suggested interaction bindings, this information shows paths related to the interaction bindings being mimicked by that device.  
         */
        render_model_get_subaction_paths(render_model: RID): PackedStringArray
        
        /** Returns the top level path associated with this [param render_model]. If provided this identifies whether the render model is associated with the player's hands or other body part. */
        render_model_get_top_level_path(render_model: RID): string
        
        /** Returns the tracking confidence of the tracking data for the render model. */
        render_model_get_confidence(render_model: RID): XRPose.TrackingConfidence
        
        /** Returns the root transform of a render model. This is the tracked position relative to our [XROrigin3D] node. */
        render_model_get_root_transform(render_model: RID): Transform3D
        
        /** Returns the number of animatable nodes this render model has. */
        render_model_get_animatable_node_count(render_model: RID): int64
        
        /** Returns the name of the given animatable node. */
        render_model_get_animatable_node_name(render_model: RID, index: int64): string
        
        /** Returns `true` if this animatable node should be visible. */
        render_model_is_animatable_node_visible(render_model: RID, index: int64): boolean
        
        /** Returns the current local transform for an animatable node. This is updated every frame. */
        render_model_get_animatable_node_transform(render_model: RID, index: int64): Transform3D
        
        /** Emitted when a new render model is added. */
        readonly render_model_added: Signal<(render_model: RID) => void>
        
        /** Emitted when a render model is removed. */
        readonly render_model_removed: Signal<(render_model: RID) => void>
        
        /** Emitted when the top level path associated with a render model changed. */
        readonly render_model_top_level_path_changed: Signal<(render_model: RID) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRRenderModelExtension;
    }
    namespace OpenXRRenderModelManager {
        enum RenderModelTracker {
            /** All active render models are shown regardless of what tracker they relate to. */
            RENDER_MODEL_TRACKER_ANY = 0,
            
            /** Only active render models are shown that are not related to any tracker we manage. */
            RENDER_MODEL_TRACKER_NONE_SET = 1,
            
            /** Only active render models are shown that are related to the left hand tracker. */
            RENDER_MODEL_TRACKER_LEFT_HAND = 2,
            
            /** Only active render models are shown that are related to the right hand tracker. */
            RENDER_MODEL_TRACKER_RIGHT_HAND = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRRenderModelManager extends __NameMapNode3D {
    }
    /** Helper node that will automatically manage displaying render models.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrrendermodelmanager.html  
     */
    class OpenXRRenderModelManager<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Limits render models to the specified tracker. Include: 0 = All render models, 1 = Render models not related to a tracker, 2 = Render models related to the left hand tracker, 3 = Render models related to the right hand tracker. */
        get tracker(): int64
        set tracker(value: int64)
        
        /** Position render models local to this pose (this will adjust the position of the render models container node). */
        get make_local_to_pose(): string
        set make_local_to_pose(value: string)
        
        /** Emitted when a render model node is added as a child to this node. */
        readonly render_model_added: Signal<(render_model: OpenXRRenderModel) => void>
        
        /** Emitted when a render model child node is about to be removed from this node. */
        readonly render_model_removed: Signal<(render_model: OpenXRRenderModel) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRRenderModelManager;
    }
    namespace OpenXRSpatialAnchorCapability {
        enum PersistenceScope {
            /** Provides the application with read-only access (i.e. application cannot modify this scope) to spatial entities persisted and managed by the system. The application can use the UUID in the persistence component for this scope to correlate entities across spatial contexts and device reboots. */
            PERSISTENCE_SCOPE_SYSTEM_MANAGED = 1,
            
            /** Persistence operations and data access is limited to spatial anchors, on the same device, for the same user and same app (using [method persist_anchor] and [method unpersist_anchor] functions) */
            PERSISTENCE_SCOPE_LOCAL_ANCHORS = 1000781000,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialAnchorCapability extends __NameMapOpenXRExtensionWrapper {
    }
    /** Implementation for handling spatial entity anchor logic.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialanchorcapability.html  
     */
    class OpenXRSpatialAnchorCapability extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if spatial anchors are supported by the hardware. Only returns a valid value after OpenXR has been initialized. */
        is_spatial_anchor_supported(): boolean
        
        /** Returns `true` if persistent spatial anchors are supported by the hardware. Only returns a valid value after OpenXR has been initialized. */
        is_spatial_persistence_supported(): boolean
        
        /** Returns `true` if this persistence scope is supported by our spatial anchor capability.  
         *      
         *  **Note:** Only valid after an OpenXR instance has been created.  
         */
        is_persistence_scope_supported(scope: OpenXRSpatialAnchorCapability.PersistenceScope): boolean
        
        /** Creates a new persistence context for storing persistent data.  
         *      
         *  **Note:** This is an asynchronous method and returns an [OpenXRFutureResult] object with which to track the status, discarding this object will not cancel the creation process. On success [param user_callback] will be called if specified. The result value for this function is the [RID] for our persistence context.  
         */
        create_persistence_context(scope: OpenXRSpatialAnchorCapability.PersistenceScope, user_callback?: Callable /* = new Callable() */): OpenXRFutureResult
        
        /** Returns the internal handle for this persistence context.  
         *      
         *  **Note:** For GDExtension implementations.  
         */
        get_persistence_context_handle(persistence_context: RID): int64
        
        /** Frees a persistence context previously created with [method create_persistence_context]. */
        free_persistence_context(persistence_context: RID): void
        
        /** Creates a new anchor that will be tracked by the XR runtime. The [param transform] should be a transform in the local space of your [XROrigin3D] node. If [param spatial_context] is not specified the default will be used, this requires [member ProjectSettings.xr/openxr/extensions/spatial_entity/enable_builtin_anchor_detection] to be set. The returned tracker will track the location in case our reference space changes. */
        create_new_anchor(transform: Transform3D, spatial_context?: RID /* = new RID() */): OpenXRAnchorTracker
        
        /** Remove an anchor previously created with [method create_new_anchor]. If this anchor was persistent you must first call [method unpersist_anchor] and await its callback. */
        remove_anchor(anchor_tracker: OpenXRAnchorTracker): void
        
        /** Changes this anchor into a persistent anchor. This means its location will be stored on the device and the anchor will be restored the next time your application starts. If [param persistence_context] is not specified the default will be used, this requires [member ProjectSettings.xr/openxr/extensions/spatial_entity/enable_builtin_anchor_detection] to be set.  
         *      
         *  **Note:** This is an asynchronous method and returns an [OpenXRFutureResult] object with which to track the status, discarding this object will not cancel the creation process. On success [param user_callback] will be called if specified. The result value for this function is a boolean which will be set to `true` on successful completion.  
         */
        persist_anchor(anchor_tracker: OpenXRAnchorTracker, persistence_context?: RID /* = new RID() */, user_callback?: Callable /* = new Callable() */): null | OpenXRFutureResult
        
        /** Removes the persistent data from this anchor. The runtime will not recreate the anchor when your application restarts. If [param persistence_context] is not specified the default will be used, this requires [member ProjectSettings.xr/openxr/extensions/spatial_entity/enabled] to be set.  
         *      
         *  **Note:** This is an asynchronous method and returns an [OpenXRFutureResult] object with which to track the status, discarding this object will not cancel the creation process. On success [param user_callback] will be called if specified. The result value for this function is a boolean which will be set to `true` on successful completion.  
         */
        unpersist_anchor(anchor_tracker: OpenXRAnchorTracker, persistence_context?: RID /* = new RID() */, user_callback?: Callable /* = new Callable() */): null | OpenXRFutureResult
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialAnchorCapability;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationAnchor extends __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader {
    }
    /** Configuration header for spatial anchors.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationanchor.html  
     */
    class OpenXRSpatialCapabilityConfigurationAnchor extends OpenXRSpatialCapabilityConfigurationBaseHeader {
        constructor(identifier?: any)
        /** Returns the components enabled by this configuration.  
         *      
         *  **Note:** Only valid after this configuration was used to create a spatial context.  
         */
        get_enabled_components(): PackedInt64Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationAnchor;
    }
    namespace OpenXRSpatialCapabilityConfigurationAprilTag {
        enum AprilTagDict {
            /** 4 by 4 bits, minimum Hamming distance between any two codes = 5, 30 codes. */
            APRIL_TAG_DICT_16H5 = 1,
            
            /** 5 by 5 bits, minimum Hamming distance between any two codes = 9, 35 codes. */
            APRIL_TAG_DICT_25H9 = 2,
            
            /**  6 by 6 bits, minimum Hamming distance between any two codes = 10, 2320 codes. */
            APRIL_TAG_DICT_36H10 = 3,
            
            /** 6 by 6 bits, minimum Hamming distance between any two codes = 11, 587 codes. */
            APRIL_TAG_DICT_36H11 = 4,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationAprilTag extends __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader {
    }
    /** Configuration header for April tag markers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationapriltag.html  
     */
    class OpenXRSpatialCapabilityConfigurationAprilTag extends OpenXRSpatialCapabilityConfigurationBaseHeader {
        constructor(identifier?: any)
        /** Returns the components enabled by this configuration.  
         *      
         *  **Note:** Only valid after this configuration was used to create a spatial context.  
         */
        get_enabled_components(): PackedInt64Array
        
        /** Dictionary to use to decode April tags.  
         *      
         *  **Note:** Must be set before using this configuration to create a spatial context.  
         */
        get april_dict(): int64
        set april_dict(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationAprilTag;
    }
    namespace OpenXRSpatialCapabilityConfigurationAruco {
        enum ArucoDict {
            /** 4 by 4 pixel Aruco marker dictionary with 50 IDs. */
            ARUCO_DICT_4X4_50 = 1,
            
            /** 4 by 4 pixel Aruco marker dictionary with 100 IDs. */
            ARUCO_DICT_4X4_100 = 2,
            
            /** 4 by 4 pixel Aruco marker dictionary with 250 IDs. */
            ARUCO_DICT_4X4_250 = 3,
            
            /** 4 by 4 pixel Aruco marker dictionary with 1000 IDs. */
            ARUCO_DICT_4X4_1000 = 4,
            
            /** 5 by 5 pixel Aruco marker dictionary with 50 IDs. */
            ARUCO_DICT_5X5_50 = 5,
            
            /** 5 by 5 pixel Aruco marker dictionary with 100 IDs. */
            ARUCO_DICT_5X5_100 = 6,
            
            /** 5 by 5 pixel Aruco marker dictionary with 250 IDs. */
            ARUCO_DICT_5X5_250 = 7,
            
            /** 5 by 5 pixel Aruco marker dictionary with 1000 IDs. */
            ARUCO_DICT_5X5_1000 = 8,
            
            /** 6 by 6 pixel Aruco marker dictionary with 50 IDs. */
            ARUCO_DICT_6X6_50 = 9,
            
            /** 6 by 6 pixel Aruco marker dictionary with 100 IDs. */
            ARUCO_DICT_6X6_100 = 10,
            
            /** 6 by 6 pixel Aruco marker dictionary with 250 IDs. */
            ARUCO_DICT_6X6_250 = 11,
            
            /** 6 by 6 pixel Aruco marker dictionary with 1000 IDs. */
            ARUCO_DICT_6X6_1000 = 12,
            
            /** 7 by 7 pixel Aruco marker dictionary with 50 IDs. */
            ARUCO_DICT_7X7_50 = 13,
            
            /** 7 by 7 pixel Aruco marker dictionary with 100 IDs. */
            ARUCO_DICT_7X7_100 = 14,
            
            /** 7 by 7 pixel Aruco marker dictionary with 250 IDs. */
            ARUCO_DICT_7X7_250 = 15,
            
            /** 7 by 7 pixel Aruco marker dictionary with 1000 IDs. */
            ARUCO_DICT_7X7_1000 = 16,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationAruco extends __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader {
    }
    /** Configuration header for Aruco markers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationaruco.html  
     */
    class OpenXRSpatialCapabilityConfigurationAruco extends OpenXRSpatialCapabilityConfigurationBaseHeader {
        constructor(identifier?: any)
        /** Returns the components enabled by this configuration.  
         *      
         *  **Note:** Only valid after this configuration was used to create a spatial context.  
         */
        get_enabled_components(): PackedInt64Array
        
        /** Dictionary to use to decode Aruco markers.  
         *      
         *  **Note:** Must be set before using this configuration to create a spatial context.  
         */
        get aruco_dict(): int64
        set aruco_dict(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationAruco;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader extends __NameMapRefCounted {
    }
    /** Wrapper base class for OpenXR Spatial Capability Configuration headers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationbaseheader.html  
     */
    class OpenXRSpatialCapabilityConfigurationBaseHeader extends RefCounted {
        constructor(identifier?: any)
        /** Return `true` if this object contains a valid configuration that can be retrieved when calling [method _get_configuration]. */
        /* gdvirtual */ _has_valid_configuration(): boolean
        
        /** Return a pointer (encoded as an `int64_t`) to a struct holding the spatial capability configuration data. The memory for this struct should remain accessible as long as this object remains instantiated. */
        /* gdvirtual */ _get_configuration(): int64
        
        /** Returns `true` if this object contains a valid configuration that can be used when calling [method OpenXRSpatialEntityExtension.create_spatial_context]. */
        has_valid_configuration(): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationMicroQrCode extends __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader {
    }
    /** Configuration header for QR code markers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationmicroqrcode.html  
     */
    class OpenXRSpatialCapabilityConfigurationMicroQrCode extends OpenXRSpatialCapabilityConfigurationBaseHeader {
        constructor(identifier?: any)
        /** Returns the components enabled by this configuration.  
         *      
         *  **Note:** Only valid after this configuration was used to create a spatial context.  
         */
        get_enabled_components(): PackedInt64Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationMicroQrCode;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationPlaneTracking extends __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader {
    }
    /** Configuration header for plane tracking.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationplanetracking.html  
     */
    class OpenXRSpatialCapabilityConfigurationPlaneTracking extends OpenXRSpatialCapabilityConfigurationBaseHeader {
        constructor(identifier?: any)
        /** Returns `true` if we support the mesh 2D component (only valid after the OpenXR session has started). You can query these using the [OpenXRSpatialComponentMesh2DList] data object. */
        supports_mesh_2d(): boolean
        
        /** Returns `true` if we support the polygon 2D component (only valid after the OpenXR session has started). You can query these using the [OpenXRSpatialComponentPolygon2DList] data object. */
        supports_polygons(): boolean
        
        /** Returns `true` if we support the plane semantic label component (only valid after the OpenXR session has started). You can query these using the [OpenXRSpatialComponentPlaneSemanticLabelList] data object. */
        supports_labels(): boolean
        
        /** Returns the components enabled by this configuration.  
         *      
         *  **Note:** Only valid after this configuration was used to create a spatial context.  
         */
        get_enabled_components(): PackedInt64Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationPlaneTracking;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialCapabilityConfigurationQrCode extends __NameMapOpenXRSpatialCapabilityConfigurationBaseHeader {
    }
    /** Configuration header for micro QR code markers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcapabilityconfigurationqrcode.html  
     */
    class OpenXRSpatialCapabilityConfigurationQrCode extends OpenXRSpatialCapabilityConfigurationBaseHeader {
        constructor(identifier?: any)
        /** Returns the components enabled by this configuration.  
         *      
         *  **Note:** Only valid after this configuration was used to create a spatial context.  
         */
        get_enabled_components(): PackedInt64Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialCapabilityConfigurationQrCode;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentAnchorList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries anchor result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentanchorlist.html  
     */
    class OpenXRSpatialComponentAnchorList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the transform for the entity at this [param index]. */
        get_entity_pose(index: int64): Transform3D
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentAnchorList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentBounded2DList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries bounded2d result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentbounded2dlist.html  
     */
    class OpenXRSpatialComponentBounded2DList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the center of our bounding rectangle for the entity at this [param index]. */
        get_center_pose(index: int64): Transform3D
        
        /** Returns the size of our bounding rectangle for the entity at this [param index]. */
        get_size(index: int64): Vector2
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentBounded2DList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentBounded3DList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries bounded3d result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentbounded3dlist.html  
     */
    class OpenXRSpatialComponentBounded3DList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the center of our bounding box for the entity at this [param index]. */
        get_center_pose(index: int64): Transform3D
        
        /** Returns the size of our bounding box for the entity at this [param index]. */
        get_size(index: int64): Vector3
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentBounded3DList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentData extends __NameMapRefCounted {
    }
    /** Object for storing OpenXR spatial entity component data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentdata.html  
     */
    class OpenXRSpatialComponentData extends RefCounted {
        constructor(identifier?: any)
        /** Set the expected capacity as provided by the spatial entities query system. Buffers should be initialized with the correct storage. */
        /* gdvirtual */ _set_capacity(capacity: int64): void
        
        /** Return the component type for the component we store data for. */
        /* gdvirtual */ _get_component_type(): int64
        
        /** Return a pointer to the structure data that will be submitted along with the snapshot query. This pointer must remain valid as long as this object is instantiated. */
        /* gdvirtual */ _get_structure_data(next: int64): int64
        
        /** Set the expected capacity as provided by the spatial entities query system. Buffers should be initialized with the correct storage. */
        set_capacity(capacity: int64): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentData;
    }
    namespace OpenXRSpatialComponentMarkerList {
        enum MarkerType {
            /** Unknown or unset marker type. */
            MARKER_TYPE_UNKNOWN = 0,
            
            /** Marker based on a QR code. */
            MARKER_TYPE_QRCODE = 1,
            
            /** Marker based on a micro QR code. */
            MARKER_TYPE_MICRO_QRCODE = 2,
            
            /** Marker based on an Aruco code. */
            MARKER_TYPE_ARUCO = 3,
            
            /** Marker based on an April Tag. */
            MARKER_TYPE_APRIL_TAG = 4,
            
            /** Maximum value for this enum. */
            MARKER_TYPE_MAX = 5,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentMarkerList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries marker result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentmarkerlist.html  
     */
    class OpenXRSpatialComponentMarkerList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the marker type for the marker at this [param index]. */
        get_marker_type(index: int64): OpenXRSpatialComponentMarkerList.MarkerType
        
        /** Returns the marker ID for the marker at this [param index]. Only applicable for Aruco or April Tag markers. */
        get_marker_id(index: int64): int64
        
        /** Returns either a [String] or a [PackedByteArray] buffer with data for the marker at this [param index]. Only applicable for QR code markers. */
        get_marker_data(snapshot: RID, index: int64): any
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentMarkerList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentMesh2DList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries mesh2d result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentmesh2dlist.html  
     */
    class OpenXRSpatialComponentMesh2DList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the transform for positioning our mesh for the entity at this [param index]. */
        get_transform(index: int64): Transform3D
        
        /** Returns the mesh vertices for the entity at this [param index]. */
        get_vertices(snapshot: RID, index: int64): PackedVector2Array
        
        /** Returns the mesh indices for the entity at this [param index]. */
        get_indices(snapshot: RID, index: int64): PackedInt32Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentMesh2DList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentMesh3DList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries mesh3d result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentmesh3dlist.html  
     */
    class OpenXRSpatialComponentMesh3DList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the transform for positioning our mesh for the entity at this [param index]. */
        get_transform(index: int64): Transform3D
        
        /** Returns the mesh for the entity at this [param index]. */
        get_mesh(index: int64): null | Mesh
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentMesh3DList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentParentList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries parent result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentparentlist.html  
     */
    class OpenXRSpatialComponentParentList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the RID for the parent entity at this [param index]. */
        get_parent(index: int64): RID
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentParentList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentPersistenceList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the query persistence result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentpersistencelist.html  
     */
    class OpenXRSpatialComponentPersistenceList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the persistent uuid for the entity at this [param index]. */
        get_persistent_uuid(index: int64): string
        
        /** Returns the persistent state (`XrSpatialPersistenceStateEXT`) for the entity at this [param index]. */
        get_persistent_state(index: int64): int64
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentPersistenceList;
    }
    namespace OpenXRSpatialComponentPlaneAlignmentList {
        enum PlaneAlignment {
            /** Plane is facing upward. */
            PLANE_ALIGNMENT_HORIZONTAL_UPWARD = 0,
            
            /** Plane is facing downwards. */
            PLANE_ALIGNMENT_HORIZONTAL_DOWNWARD = 1,
            
            /** Plane is vertically aligned. */
            PLANE_ALIGNMENT_VERTICAL = 2,
            
            /** Plane has an arbitrary alignment. */
            PLANE_ALIGNMENT_ARBITRARY = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentPlaneAlignmentList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries plane alignment result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentplanealignmentlist.html  
     */
    class OpenXRSpatialComponentPlaneAlignmentList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the plane alignment for the parent entity at this [param index]. */
        get_plane_alignment(index: int64): OpenXRSpatialComponentPlaneAlignmentList.PlaneAlignment
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentPlaneAlignmentList;
    }
    namespace OpenXRSpatialComponentPlaneSemanticLabelList {
        enum PlaneSemanticLabel {
            /** Uncategorized plane. */
            PLANE_SEMANTIC_LABEL_UNCATEGORIZED = 1,
            
            /** Plane represents a floor. */
            PLANE_SEMANTIC_LABEL_FLOOR = 2,
            
            /** Plane represents a wall. */
            PLANE_SEMANTIC_LABEL_WALL = 3,
            
            /** Plane represents a ceiling. */
            PLANE_SEMANTIC_LABEL_CEILING = 4,
            
            /** Plane represents the surface of a table. */
            PLANE_SEMANTIC_LABEL_TABLE = 5,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentPlaneSemanticLabelList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries plane semantic label result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentplanesemanticlabellist.html  
     */
    class OpenXRSpatialComponentPlaneSemanticLabelList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the plane semantic label for the parent entity at this [param index]. */
        get_plane_semantic_label(index: int64): OpenXRSpatialComponentPlaneSemanticLabelList.PlaneSemanticLabel
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentPlaneSemanticLabelList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialComponentPolygon2DList extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the queries polygon2d result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcomponentpolygon2dlist.html  
     */
    class OpenXRSpatialComponentPolygon2DList extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the transform for positioning our polygon for the entity at this [param index]. */
        get_transform(index: int64): Transform3D
        
        /** Returns the polygon vertices for the entity at this [param index]. */
        get_vertices(snapshot: RID, index: int64): PackedVector2Array
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialComponentPolygon2DList;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialContextPersistenceConfig extends __NameMapOpenXRStructureBase {
    }
    /** Configuration header for spatial persistence.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialcontextpersistenceconfig.html  
     */
    class OpenXRSpatialContextPersistenceConfig extends OpenXRStructureBase {
        constructor(identifier?: any)
        /** Adds a persistence context to this configuration. You must add at least one persistence context to create a valid configuration. You can create a persistence context by calling [method OpenXRSpatialAnchorCapability.create_persistence_context]. */
        add_persistence_context(persistence_context: RID): void
        
        /** Removes a persistence context. */
        remove_persistence_context(persistence_context: RID): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialContextPersistenceConfig;
    }
    namespace OpenXRSpatialEntityExtension {
        enum Capability {
            /** Plane tracking capability. */
            CAPABILITY_PLANE_TRACKING = 1000741000,
            
            /** QR code based marker tracking capability. */
            CAPABILITY_MARKER_TRACKING_QR_CODE = 1000743000,
            
            /** Micro QR code based marker tracking capability. */
            CAPABILITY_MARKER_TRACKING_MICRO_QR_CODE = 1000743001,
            
            /** Aruco marker based marker tracking capability. */
            CAPABILITY_MARKER_TRACKING_ARUCO_MARKER = 1000743002,
            
            /** April tag based marker tracking capability. */
            CAPABILITY_MARKER_TRACKING_APRIL_TAG = 1000743003,
            
            /** Anchor capability. */
            CAPABILITY_ANCHOR = 1000762000,
        }
        enum ComponentType {
            /** Component that provides the 2D bounds for a spatial entity. The corresponding list structure is `XrSpatialComponentBounded2DListEXT`; the corresponding data structure is `XrSpatialBounded2DDataEXT`. */
            COMPONENT_TYPE_BOUNDED_2D = 1,
            
            /** Component that provides the 3D bounds for a spatial entity. The corresponding list structure is `XrSpatialComponentBounded3DListEXT`; the corresponding data structure is `XrBoxf`. */
            COMPONENT_TYPE_BOUNDED_3D = 2,
            
            /** Component that provides the XrSpatialEntityIdEXT of the parent for a spatial entity. The corresponding list structure is `XrSpatialComponentParentListEXT`; the corresponding data structure is `XrSpatialEntityIdEXT`. */
            COMPONENT_TYPE_PARENT = 3,
            
            /** Component that provides a 3D mesh for a spatial entity. The corresponding list structure is `XrSpatialComponentMesh3DListEXT`; the corresponding data structure is `XrSpatialMeshDataEXT`. */
            COMPONENT_TYPE_MESH_3D = 4,
            
            /** Component that provides the plane alignment enum for a spatial entity. The corresponding list structure is `XrSpatialComponentPlaneAlignmentListEXT`; the corresponding data structure is `XrSpatialPlaneAlignmentEXT` (Added by the `XR_EXT_spatial_plane_tracking` extension). */
            COMPONENT_TYPE_PLANE_ALIGNMENT = 1000741000,
            
            /** Component that provides a 2D mesh for a spatial entity. The corresponding list structure is `XrSpatialComponentMesh2DListEXT`; the corresponding data structure is `XrSpatialMeshDataEXT` (Added by the `XR_EXT_spatial_plane_tracking` extension). */
            COMPONENT_TYPE_MESH_2D = 1000741001,
            
            /** Component that provides a 2D boundary polygon for a spatial entity. The corresponding list structure is `XrSpatialComponentPolygon2DListEXT`; the corresponding data structure is `XrSpatialPolygon2DDataEXT` (Added by the `XR_EXT_spatial_plane_tracking` extension). */
            COMPONENT_TYPE_POLYGON_2D = 1000741002,
            
            /** Component that provides a semantic label for a plane. The corresponding list structure is `XrSpatialComponentPlaneSemanticLabelListEXT`; the corresponding data structure is `XrSpatialPlaneSemanticLabelEXT` (Added by the `XR_EXT_spatial_plane_tracking` extension). */
            COMPONENT_TYPE_PLANE_SEMANTIC_LABEL = 1000741003,
            
            /** A component describing the marker type, ID and location. The corresponding list structure is `XrSpatialComponentMarkerListEXT`; the corresponding data structure is `XrSpatialMarkerDataEXT` (Added by the `XR_EXT_spatial_marker_tracking` extension). */
            COMPONENT_TYPE_MARKER = 1000743000,
            
            /** Component that provides the location for an anchor. The corresponding list structure is `XrSpatialComponentAnchorListEXT`; the corresponding data structure is `XrPosef` (Added by the `XR_EXT_spatial_anchor` extension). */
            COMPONENT_TYPE_ANCHOR = 1000762000,
            
            /** Component that provides the persisted UUID for a spatial entity. The corresponding list structure is `XrSpatialComponentPersistenceListEXT; the corresponding data structure is `XrSpatialPersistenceDataEXT` (Added by the `XR_EXT_spatial_persistence` extension). */
            COMPONENT_TYPE_PERSISTENCE = 1000763000,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialEntityExtension extends __NameMapOpenXRExtensionWrapper {
    }
    /** OpenXR extension that handles spatial entities.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialentityextension.html  
     */
    class OpenXRSpatialEntityExtension extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if this spatial entity [param capability] is supported by the hardware used. */
        supports_capability(capability: OpenXRSpatialEntityExtension.Capability): boolean
        
        /** Returns `true` if this [param capability] supports the [param component_type]. */
        supports_component_type(capability: OpenXRSpatialEntityExtension.Capability, component_type: OpenXRSpatialEntityExtension.ComponentType): boolean
        
        /** Creates a new spatial context that handles entities for the provided capability configurations. [param capability_configurations] is an array of [OpenXRSpatialCapabilityConfigurationBaseHeader] with the needed capability configuration data.  
         *  [param next] is an optional parameter that can contain additional information for creating our spatial context.  
         *      
         *  **Note:** This is an asynchronous method and returns an [OpenXRFutureResult] object with which to track the status, discarding this object will not cancel the creation process. On success [param user_callback] will be called if specified. The result data for this function is the [RID] for our spatial context.  
         */
        create_spatial_context(capability_configurations: GArray<OpenXRSpatialCapabilityConfigurationBaseHeader>, next?: OpenXRStructureBase, user_callback?: Callable /* = new Callable() */): OpenXRFutureResult
        
        /** Returns `true` if the spatial context finished its creation and is ready to be used. */
        get_spatial_context_ready(spatial_context: RID): boolean
        
        /** Frees a spatial context previously created when calling [method create_spatial_context]. If the spatial context creation is still ongoing, the asynchronous process is cancelled. */
        free_spatial_context(spatial_context: RID): void
        
        /** Returns the OpenXR spatial context handle for this snapshot.  
         *      
         *  **Note:** This method is intended to be used from GDExtensions that implement spatial entity capability handlers.  
         */
        get_spatial_context_handle(spatial_context: RID): int64
        
        /** Starts a new discovery query, this will gather all objects tracked by the [param spatial_context] that have at least one of the component types specified in [param component_types].  
         *  [param next] is an optional parameter that can contain additional information for executing the discovery query.  
         *      
         *  **Note:** This is an asynchronous method and returns an [OpenXRFutureResult] object with which to track the status, discarding this object will not cancel the discovery process. On success [param user_callback] will be called if specified. The result data for this function is the [RID] for our snapshot.  
         */
        discover_spatial_entities(spatial_context: RID, component_types: PackedInt64Array | int64[], next?: OpenXRStructureBase, user_callback?: Callable /* = new Callable() */): null | OpenXRFutureResult
        
        /** Performs a snapshot for a limited number of entities. This is NOT an asynchronous method and will return the snapshot immediately. */
        update_spatial_entities(spatial_context: RID, entities: GArray<RID>, component_types: PackedInt64Array | int64[], next?: OpenXRStructureBase): RID
        
        /** Frees a spatial snapshot previously created when calling [method discover_spatial_entities]. If the spatial snapshot creation is still ongoing, the asynchronous process is cancelled. */
        free_spatial_snapshot(spatial_snapshot: RID): void
        
        /** Returns the OpenXR spatial snapshot handle for this snapshot.  
         *      
         *  **Note:** This method is intended to be used from GDExtensions that implement spatial entity capability handlers.  
         */
        get_spatial_snapshot_handle(spatial_snapshot: RID): int64
        
        /** Returns the spatial context related to this spatial snapshot. */
        get_spatial_snapshot_context(spatial_snapshot: RID): RID
        
        /** Queries the snapshot data. This will find all entities in the snapshot that contain all requested components in [param component_data]. The objects held within [param component_data] will then be populated with the queried data. [param component_data] must always have an object of [OpenXRSpatialQueryResultData] as the first entry.  
         *  [param next] is an optional parameter that can contain additional information passed when setting our query conditions.  
         */
        query_snapshot(spatial_snapshot: RID, component_data: GArray<OpenXRSpatialComponentData>, next?: OpenXRStructureBase): boolean
        
        /** Returns a string from a buffer that was retrieved when taking a snapshot. */
        get_string(spatial_snapshot: RID, buffer_id: int64): string
        
        /** Returns a buffer with 8 bit ints from a buffer that was retrieved when taking a snapshot. */
        get_uint8_buffer(spatial_snapshot: RID, buffer_id: int64): PackedByteArray
        
        /** Returns a buffer with 16 bit ints from a buffer that was retrieved when taking a snapshot. */
        get_uint16_buffer(spatial_snapshot: RID, buffer_id: int64): PackedInt32Array
        
        /** Returns a buffer with 32 bit ints from a buffer that was retrieved when taking a snapshot. */
        get_uint32_buffer(spatial_snapshot: RID, buffer_id: int64): PackedInt32Array
        
        /** Returns a buffer with floats from a buffer that was retrieved when taking a snapshot. */
        get_float_buffer(spatial_snapshot: RID, buffer_id: int64): PackedFloat32Array
        
        /** Returns a buffer with [Vector2] entries from a buffer that was retrieved when taking a snapshot. */
        get_vector2_buffer(spatial_snapshot: RID, buffer_id: int64): PackedVector2Array
        
        /** Returns a buffer with [Vector3] entries from a buffer that was retrieved when taking a snapshot. */
        get_vector3_buffer(spatial_snapshot: RID, buffer_id: int64): PackedVector3Array
        
        /** Returns the [RID] for the specified spatial entity ID. */
        find_spatial_entity(entity_id: int64): RID
        
        /** Registers an entity that was created directly on the OpenXR runtime. */
        add_spatial_entity(spatial_context: RID, entity_id: int64, entity: int64): RID
        
        /** Creates a new entity for this [param entity_id]. The [param spatial_context] should match the context that discovered the entity. */
        make_spatial_entity(spatial_context: RID, entity_id: int64): RID
        
        /** Returns the internal `XrSpatialEntityIdEXT` associated with the entity. */
        get_spatial_entity_id(entity: RID): int64
        
        /** Returns the spatial context for this entity. */
        get_spatial_entity_context(entity: RID): RID
        
        /** Frees an entity previously created when calling [method add_spatial_entity] or [method make_spatial_entity]. */
        free_spatial_entity(entity: RID): void
        
        /** Emitted when OpenXR recommends running a discovery query because entities managed by this spatial context have (likely) changed. */
        readonly spatial_discovery_recommended: Signal<(spatial_context: RID) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialEntityExtension;
    }
    namespace OpenXRSpatialEntityTracker {
        enum EntityTrackingState {
            /** This anchor has stopped tracking. */
            ENTITY_TRACKING_STATE_STOPPED = 1,
            
            /** Tracking is currently paused. */
            ENTITY_TRACKING_STATE_PAUSED = 2,
            
            /** This anchor is currently being tracked. */
            ENTITY_TRACKING_STATE_TRACKING = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialEntityTracker extends __NameMapXRPositionalTracker {
    }
    /** Base class for Positional trackers managed by OpenXR's spatial entity extensions.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialentitytracker.html  
     */
    class OpenXRSpatialEntityTracker extends XRPositionalTracker {
        constructor(identifier?: any)
        /** The spatial entity associated with this tracker. */
        get entity(): RID
        set entity(value: RID)
        
        /** The spatial tracking state for this tracker. */
        get spatial_tracking_state(): int64
        set spatial_tracking_state(value: int64)
        readonly spatial_tracking_state_changed: Signal<(spatial_tracking_state: int64) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialEntityTracker;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialMarkerTrackingCapability extends __NameMapOpenXRExtensionWrapper {
    }
    /** Implementation for handling spatial entity marker tracking logic.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialmarkertrackingcapability.html  
     */
    class OpenXRSpatialMarkerTrackingCapability extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if QR code marker tracking is supported by the current device. */
        is_qrcode_supported(): boolean
        
        /** Returns `true` if micro QR code marker tracking is supported by the current device. */
        is_micro_qrcode_supported(): boolean
        
        /** Returns `true` if Aruco marker tracking is supported by the current device. */
        is_aruco_supported(): boolean
        
        /** Returns `true` if April tag marker tracking is supported by the current device. */
        is_april_tag_supported(): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialMarkerTrackingCapability;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialPlaneTrackingCapability extends __NameMapOpenXRExtensionWrapper {
    }
    /** Implementation for handling spatial entity plane tracking logic.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialplanetrackingcapability.html  
     */
    class OpenXRSpatialPlaneTrackingCapability extends OpenXRExtensionWrapper {
        constructor(identifier?: any)
        /** Returns `true` if plane tracking is supported by the current device. */
        is_supported(): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialPlaneTrackingCapability;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRSpatialQueryResultData extends __NameMapOpenXRSpatialComponentData {
    }
    /** Object for storing the main query result data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrspatialqueryresultdata.html  
     */
    class OpenXRSpatialQueryResultData extends OpenXRSpatialComponentData {
        constructor(identifier?: any)
        /** Returns the number of entities that were retrieved. */
        get_capacity(): int64
        
        /** Returns the entity id (`XrSpatialEntityIdEXT`) for the entity at this [param index]. */
        get_entity_id(index: int64): int64
        
        /** Returns the entity state for the entity at this [param index]. */
        get_entity_state(index: int64): OpenXRSpatialEntityTracker.EntityTrackingState
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRSpatialQueryResultData;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRStructureBase extends __NameMapRefCounted {
    }
    /** Object for storing OpenXR structure data.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrstructurebase.html  
     */
    class OpenXRStructureBase extends RefCounted {
        constructor(identifier?: any)
        /* gdvirtual */ _get_header(next: int64): int64
        
        /** Returns the structure type (OpenXR `XrStructureType`) used for this structure. */
        get_structure_type(): int64
        
        /** Setting another structure object here chains these structures together to extend the API functionality. Consult the OpenXR documentation for which structures can be used with a given API call. */
        get next(): null | OpenXRStructureBase
        set next(value: null | OpenXRStructureBase)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRStructureBase;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOpenXRVisibilityMask extends __NameMapVisualInstance3D {
    }
    /** Draws a stereo correct visibility mask.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_openxrvisibilitymask.html  
     */
    class OpenXRVisibilityMask<Map extends NodePathMap = any> extends VisualInstance3D<Map> {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOpenXRVisibilityMask;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOptimizedTranslation extends __NameMapTranslation {
    }
    /** An optimized translation.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_optimizedtranslation.html  
     */
    class OptimizedTranslation extends Translation {
        constructor(identifier?: any)
        /** Generates and sets an optimized translation from the given [Translation] resource.  
         *      
         *  **Note:** Messages in [param from] should not use context or plural forms.  
         *      
         *  **Note:** This method is intended to be used in the editor. It does nothing when called from an exported project.  
         */
        generate(from: Translation): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOptimizedTranslation;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapOptionButton extends __NameMapButton {
    }
    /** A button that brings up a dropdown with selectable options when pressed.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_optionbutton.html  
     */
    class OptionButton<Map extends NodePathMap = any> extends Button<Map> {
        constructor(identifier?: any)
        /** Adds an item, with text [param label] and (optionally) [param id]. If no [param id] is passed, the item index will be used as the item's ID. New items are appended at the end.  
         *      
         *  **Note:** The item will be selected if there are no other items.  
         */
        add_item(label: string, id?: int64 /* = -1 */): void
        
        /** Adds an item, with a [param texture] icon, text [param label] and (optionally) [param id]. If no [param id] is passed, the item index will be used as the item's ID. New items are appended at the end.  
         *      
         *  **Note:** The item will be selected if there are no other items.  
         */
        add_icon_item(texture: Texture2D, label: string, id?: int64 /* = -1 */): void
        
        /** Sets the text of the item at index [param idx]. */
        set_item_text(idx: int64, text: string): void
        
        /** Sets the icon of the item at index [param idx]. */
        set_item_icon(idx: int64, texture: Texture2D): void
        
        /** Sets whether the item at index [param idx] is disabled.  
         *  Disabled items are drawn differently in the dropdown and are not selectable by the user. If the current selected item is set as disabled, it will remain selected.  
         */
        set_item_disabled(idx: int64, disabled: boolean): void
        
        /** Sets the ID of the item at index [param idx]. */
        set_item_id(idx: int64, id: int64): void
        
        /** Sets the metadata of an item. Metadata may be of any type and can be used to store extra information about an item, such as an external string ID. */
        set_item_metadata(idx: int64, metadata: any): void
        
        /** Sets the tooltip of the item at index [param idx]. */
        set_item_tooltip(idx: int64, tooltip: string): void
        
        /** Sets the auto translate mode of the item at index [param idx].  
         *  Items use [constant Node.AUTO_TRANSLATE_MODE_INHERIT] by default, which uses the same auto translate mode as the [OptionButton] itself.  
         */
        set_item_auto_translate_mode(idx: int64, mode: Node.AutoTranslateMode): void
        
        /** Returns the text of the item at index [param idx]. */
        get_item_text(idx: int64): string
        
        /** Returns the icon of the item at index [param idx]. */
        get_item_icon(idx: int64): null | Texture2D
        
        /** Returns the ID of the item at index [param idx]. */
        get_item_id(idx: int64): int64
        
        /** Returns the index of the item with the given [param id]. */
        get_item_index(id: int64): int64
        
        /** Retrieves the metadata of an item. Metadata may be any type and can be used to store extra information about an item, such as an external string ID. */
        get_item_metadata(idx: int64): any
        
        /** Returns the tooltip of the item at index [param idx]. */
        get_item_tooltip(idx: int64): string
        
        /** Returns the auto translate mode of the item at index [param idx]. */
        get_item_auto_translate_mode(idx: int64): Node.AutoTranslateMode
        
        /** Returns `true` if the item at index [param idx] is disabled. */
        is_item_disabled(idx: int64): boolean
        
        /** Returns `true` if the item at index [param idx] is marked as a separator. */
        is_item_separator(idx: int64): boolean
        
        /** Adds a separator to the list of items. Separators help to group items, and can optionally be given a [param text] header. A separator also gets an index assigned, and is appended at the end of the item list. */
        add_separator(text?: string /* = '' */): void
        
        /** Clears all the items in the [OptionButton]. */
        clear(): void
        
        /** Selects an item by index and makes it the current item. This will work even if the item is disabled.  
         *  Passing `-1` as the index deselects any currently selected item.  
         */
        select(idx: int64): void
        
        /** Returns the ID of the selected item, or `-1` if no item is selected. */
        get_selected_id(): int64
        
        /** Gets the metadata of the selected item. Metadata for items can be set using [method set_item_metadata]. */
        get_selected_metadata(): any
        
        /** Removes the item at index [param idx]. */
        remove_item(idx: int64): void
        
        /** Returns the [PopupMenu] contained in this button.  
         *  **Warning:** This is a required internal node, removing and freeing it may cause a crash. If you wish to hide it or any of its children, use their [member Window.visible] property.  
         */
        get_popup(): null | PopupMenu
        
        /** Adjusts popup position and sizing for the [OptionButton], then shows the [PopupMenu]. Prefer this over using `get_popup().popup()`. */
        show_popup(): void
        
        /** Returns `true` if this button contains at least one item which is not disabled, or marked as a separator. */
        has_selectable_items(): boolean
        
        /** Returns the index of the first item which is not disabled, or marked as a separator. If [param from_last] is `true`, the items will be searched in reverse order.  
         *  Returns `-1` if no item is found.  
         */
        get_selectable_item(from_last?: boolean /* = false */): int64
        
        /** If `true`, shortcuts are disabled and cannot be used to trigger the button. */
        set_disable_shortcuts(disabled: boolean): void
        
        /** The index of the currently selected item, or `-1` if no item is selected. */
        get selected(): int64
        set selected(value: int64)
        
        /** If `true`, minimum size will be determined by the longest item's text, instead of the currently selected one's.  
         *      
         *  **Note:** For performance reasons, the minimum size doesn't update immediately when adding, removing or modifying items.  
         */
        get fit_to_longest_item(): boolean
        set fit_to_longest_item(value: boolean)
        
        /** If `true`, the currently selected item can be selected again. */
        get allow_reselect(): boolean
        set allow_reselect(value: boolean)
        
        /** The number of items to select from. */
        get item_count(): int64
        set item_count(value: int64)
        
        /** Emitted when the current item has been changed by the user. The index of the item selected is passed as argument.  
         *  [member allow_reselect] must be enabled to reselect an item.  
         */
        readonly item_selected: Signal<(index: int64) => void>
        
        /** Emitted when the user navigates to an item using the [member ProjectSettings.input/ui_up] or [member ProjectSettings.input/ui_down] input actions. The index of the item selected is passed as argument. */
        readonly item_focused: Signal<(index: int64) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapOptionButton;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPCKPacker extends __NameMapRefCounted {
    }
    /** Creates packages that can be loaded into a running project.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_pckpacker.html  
     */
    class PCKPacker extends RefCounted {
        constructor(identifier?: any)
        /** Creates a new PCK file at the file path [param pck_path]. The `.pck` file extension isn't added automatically, so it should be part of [param pck_path] (even though it's not required). */
        pck_start(pck_path: string, alignment?: int64 /* = 32 */, key?: string /* = '0000000000000000000000000000000000000000000000000000000000000000' */, encrypt_directory?: boolean /* = false */): Error
        
        /** Adds the [param source_path] file to the current PCK package at the [param target_path] internal path. The `res://` prefix for [param target_path] is optional and stripped internally. File content is immediately written to the PCK. */
        add_file(target_path: string, source_path: string, encrypt?: boolean /* = false */): Error
        
        /** Registers a file removal of the [param target_path] internal path to the PCK. This is mainly used for patches. If the file at this path has been loaded from a previous PCK, it will be removed. The `res://` prefix for [param target_path] is optional and stripped internally. */
        add_file_removal(target_path: string): Error
        
        /** Writes the file directory and closes the PCK. If [param verbose] is `true`, a list of files added will be printed to the console for easier debugging.  
         *      
         *  **Note:** [PCKPacker] will automatically flush when it's freed, which happens when it goes out of scope or when it gets assigned with `null`. In C# the reference must be disposed after use, either with the `using` statement or by calling the `Dispose` method directly.  
         */
        flush(verbose?: boolean /* = false */): Error
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPCKPacker;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPackedDataContainer extends __NameMapResource {
    }
    /** Efficiently packs and serializes [Array] or [Dictionary].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packeddatacontainer.html  
     */
    class PackedDataContainer extends Resource {
        constructor(identifier?: any)
        _iter_init(_unnamed_arg0: GArray): any
        _iter_get(_unnamed_arg0: any): any
        _iter_next(_unnamed_arg0: GArray): any
        
        /** Packs the given container into a binary representation. The [param value] must be either [Array] or [Dictionary], any other type will result in invalid data error.  
         *      
         *  **Note:** Subsequent calls to this method will overwrite the existing data.  
         */
        pack(value: any): Error
        
        /** Returns the size of the packed container (see [method Array.size] and [method Dictionary.size]). */
        size(): int64
        get __data__(): PackedByteArray
        set __data__(value: PackedByteArray | byte[] | ArrayBuffer)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPackedDataContainer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPackedDataContainerRef extends __NameMapRefCounted {
    }
    /** An internal class used by [PackedDataContainer] to pack nested arrays and dictionaries.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packeddatacontainerref.html  
     */
    class PackedDataContainerRef extends RefCounted {
        constructor(identifier?: any)
        /** Returns the size of the packed container (see [method Array.size] and [method Dictionary.size]). */
        size(): int64
        _iter_init(_unnamed_arg0: GArray): any
        _iter_get(_unnamed_arg0: any): any
        _iter_next(_unnamed_arg0: GArray): any
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPackedDataContainerRef;
    }
    namespace PackedScene {
        enum GenEditState {
            /** If passed to [method instantiate], blocks edits to the scene state. */
            GEN_EDIT_STATE_DISABLED = 0,
            
            /** If passed to [method instantiate], provides local scene resources to the local scene.  
             *      
             *  **Note:** Only available in editor builds.  
             */
            GEN_EDIT_STATE_INSTANCE = 1,
            
            /** If passed to [method instantiate], provides local scene resources to the local scene. Only the main scene should receive the main edit state.  
             *      
             *  **Note:** Only available in editor builds.  
             */
            GEN_EDIT_STATE_MAIN = 2,
            
            /** It's similar to [constant GEN_EDIT_STATE_MAIN], but for the case where the scene is being instantiated to be the base of another one.  
             *      
             *  **Note:** Only available in editor builds.  
             */
            GEN_EDIT_STATE_MAIN_INHERITED = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPackedScene extends __NameMapResource {
    }
    /** An abstraction of a serialized scene.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packedscene.html  
     */
    class PackedScene<T extends Node = Node> extends Resource {
        constructor(identifier?: any)
        /** Packs the [param path] node, and all owned sub-nodes, into this [PackedScene]. Any existing data will be cleared. See [member Node.owner]. */
        pack(path: T): Error
        
        /** Instantiates the scene's node hierarchy. Triggers child scene instantiation(s). Triggers a [constant Node.NOTIFICATION_SCENE_INSTANTIATED] notification on the root node. */
        instantiate(edit_state?: PackedScene.GenEditState /* = 0 */): T
        
        /** Returns `true` if the scene file has nodes. */
        can_instantiate(): boolean
        
        /** Returns the [SceneState] representing the scene file contents. */
        get_state(): null | SceneState
        get _bundled(): GDictionary
        set _bundled(value: GDictionary)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPackedScene;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPacketPeer extends __NameMapRefCounted {
    }
    /** Abstraction and base class for packet-based protocols.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packetpeer.html  
     */
    class PacketPeer extends RefCounted {
        constructor(identifier?: any)
        /** Gets a Variant. If [param allow_objects] is `true`, decoding objects is allowed.  
         *  Internally, this uses the same decoding mechanism as the [method @GlobalScope.bytes_to_var] method.  
         *  **Warning:** Deserialized objects can contain code which gets executed. Do not use this option if the serialized object comes from untrusted sources to avoid potential security threats such as remote code execution.  
         */
        get_var(allow_objects?: boolean /* = false */): any
        
        /** Sends a [Variant] as a packet. If [param full_objects] is `true`, encoding objects is allowed (and can potentially include code).  
         *  Internally, this uses the same encoding mechanism as the [method @GlobalScope.var_to_bytes] method.  
         */
        put_var(var_: any, full_objects?: boolean /* = false */): Error
        
        /** Gets a raw packet. */
        get_packet(): PackedByteArray
        
        /** Sends a raw packet. */
        put_packet(buffer: PackedByteArray | byte[] | ArrayBuffer): Error
        
        /** Returns the error state of the last packet received (via [method get_packet] and [method get_var]). */
        get_packet_error(): Error
        
        /** Returns the number of packets currently available in the ring-buffer. */
        get_available_packet_count(): int64
        
        /** Maximum buffer size allowed when encoding [Variant]s. Raise this value to support heavier memory allocations.  
         *  The [method put_var] method allocates memory on the stack, and the buffer used will grow automatically to the closest power of two to match the size of the [Variant]. If the [Variant] is bigger than [member encode_buffer_max_size], the method will error out with [constant ERR_OUT_OF_MEMORY].  
         */
        get encode_buffer_max_size(): int64
        set encode_buffer_max_size(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPacketPeer;
    }
    namespace PacketPeerDTLS {
        enum Status {
            /** A status representing a [PacketPeerDTLS] that is disconnected. */
            STATUS_DISCONNECTED = 0,
            
            /** A status representing a [PacketPeerDTLS] that is currently performing the handshake with a remote peer. */
            STATUS_HANDSHAKING = 1,
            
            /** A status representing a [PacketPeerDTLS] that is connected to a remote peer. */
            STATUS_CONNECTED = 2,
            
            /** A status representing a [PacketPeerDTLS] in a generic error state. */
            STATUS_ERROR = 3,
            
            /** An error status that shows a mismatch in the DTLS certificate domain presented by the host and the domain requested for validation. */
            STATUS_ERROR_HOSTNAME_MISMATCH = 4,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPacketPeerDTLS extends __NameMapPacketPeer {
    }
    /** DTLS packet peer.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packetpeerdtls.html  
     */
    class PacketPeerDTLS extends PacketPeer {
        constructor(identifier?: any)
        /** Poll the connection to check for incoming packets. Call this frequently to update the status and keep the connection working. */
        poll(): void
        
        /** Connects a [param packet_peer] beginning the DTLS handshake using the underlying [PacketPeerUDP] which must be connected (see [method PacketPeerUDP.connect_to_host]). You can optionally specify the [param client_options] to be used while verifying the TLS connections. See [method TLSOptions.client] and [method TLSOptions.client_unsafe]. */
        connect_to_peer(packet_peer: PacketPeerUDP, hostname: string, client_options?: TLSOptions): Error
        
        /** Returns the status of the connection. */
        get_status(): PacketPeerDTLS.Status
        
        /** Disconnects this peer, terminating the DTLS session. */
        disconnect_from_peer(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPacketPeerDTLS;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPacketPeerExtension extends __NameMapPacketPeer {
    }
    /** @link https://docs.godotengine.org/en/4.6/classes/class_packetpeerextension.html */
    class PacketPeerExtension extends PacketPeer {
        constructor(identifier?: any)
        /* gdvirtual */ _get_packet(r_buffer: int64, r_buffer_size: int64): Error
        /* gdvirtual */ _put_packet(p_buffer: int64, p_buffer_size: int64): Error
        /* gdvirtual */ _get_available_packet_count(): int64
        /* gdvirtual */ _get_max_packet_size(): int64
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPacketPeerExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPacketPeerStream extends __NameMapPacketPeer {
    }
    /** Wrapper to use a PacketPeer over a StreamPeer.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packetpeerstream.html  
     */
    class PacketPeerStream extends PacketPeer {
        constructor(identifier?: any)
        get input_buffer_max_size(): int64
        set input_buffer_max_size(value: int64)
        get output_buffer_max_size(): int64
        set output_buffer_max_size(value: int64)
        
        /** The wrapped [StreamPeer] object. */
        get stream_peer(): null | StreamPeer
        set stream_peer(value: null | StreamPeer)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPacketPeerStream;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPacketPeerUDP extends __NameMapPacketPeer {
    }
    /** UDP packet peer.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_packetpeerudp.html  
     */
    class PacketPeerUDP extends PacketPeer {
        constructor(identifier?: any)
        /** Binds this [PacketPeerUDP] to the specified [param port] and [param bind_address] with a buffer size [param recv_buf_size], allowing it to receive incoming packets.  
         *  If [param bind_address] is set to `"*"` (default), the peer will be bound on all available addresses (both IPv4 and IPv6).  
         *  If [param bind_address] is set to `"0.0.0.0"` (for IPv4) or `"::"` (for IPv6), the peer will be bound to all available addresses matching that IP type.  
         *  If [param bind_address] is set to any valid address (e.g. `"192.168.1.101"`, `"::1"`, etc.), the peer will only be bound to the interface with that address (or fail if no interface with the given address exists).  
         */
        bind(port: int64, bind_address?: string /* = '*' */, recv_buf_size?: int64 /* = 65536 */): Error
        
        /** Closes the [PacketPeerUDP]'s underlying UDP socket. */
        close(): void
        
        /** Waits for a packet to arrive on the bound address. See [method bind].  
         *      
         *  **Note:** [method wait] can't be interrupted once it has been called. This can be worked around by allowing the other party to send a specific "death pill" packet like this:  
         *    
         */
        wait(): Error
        
        /** Returns whether this [PacketPeerUDP] is bound to an address and can receive packets. */
        is_bound(): boolean
        
        /** Calling this method connects this UDP peer to the given [param host]/[param port] pair. UDP is in reality connectionless, so this option only means that incoming packets from different addresses are automatically discarded, and that outgoing packets are always sent to the connected address (future calls to [method set_dest_address] are not allowed). This method does not send any data to the remote peer, to do that, use [method PacketPeer.put_var] or [method PacketPeer.put_packet] as usual. See also [UDPServer].  
         *      
         *  **Note:** Connecting to the remote peer does not help to protect from malicious attacks like IP spoofing, etc. Think about using an encryption technique like TLS or DTLS if you feel like your application is transferring sensitive information.  
         */
        connect_to_host(host: string, port: int64): Error
        
        /** Returns `true` if the UDP socket is open and has been connected to a remote address. See [method connect_to_host]. */
        is_socket_connected(): boolean
        
        /** Returns the IP of the remote peer that sent the last packet(that was received with [method PacketPeer.get_packet] or [method PacketPeer.get_var]). */
        get_packet_ip(): string
        
        /** Returns the port of the remote peer that sent the last packet(that was received with [method PacketPeer.get_packet] or [method PacketPeer.get_var]). */
        get_packet_port(): int64
        
        /** Returns the local port to which this peer is bound. */
        get_local_port(): int64
        
        /** Sets the destination address and port for sending packets and variables. A hostname will be resolved using DNS if needed.  
         *      
         *  **Note:** [method set_broadcast_enabled] must be enabled before sending packets to a broadcast address (e.g. `255.255.255.255`).  
         */
        set_dest_address(host: string, port: int64): Error
        
        /** Enable or disable sending of broadcast packets (e.g. `set_dest_address("255.255.255.255", 4343)`. This option is disabled by default.  
         *      
         *  **Note:** Some Android devices might require the `CHANGE_WIFI_MULTICAST_STATE` permission and this option to be enabled to receive broadcast packets too.  
         */
        set_broadcast_enabled(enabled: boolean): void
        
        /** Joins the multicast group specified by [param multicast_address] using the interface identified by [param interface_name].  
         *  You can join the same multicast group with multiple interfaces. Use [method IP.get_local_interfaces] to know which are available.  
         *      
         *  **Note:** Some Android devices might require the `CHANGE_WIFI_MULTICAST_STATE` permission for multicast to work.  
         */
        join_multicast_group(multicast_address: string, interface_name: string): Error
        
        /** Removes the interface identified by [param interface_name] from the multicast group specified by [param multicast_address]. */
        leave_multicast_group(multicast_address: string, interface_name: string): Error
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPacketPeerUDP;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPanel extends __NameMapControl {
    }
    /** A GUI control that displays a [StyleBox].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_panel.html  
     */
    class Panel<Map extends NodePathMap = any> extends Control<Map> {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPanel;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPanelContainer extends __NameMapContainer {
    }
    /** A container that keeps its child controls within the area of a [StyleBox].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_panelcontainer.html  
     */
    class PanelContainer<Map extends NodePathMap = any> extends Container<Map> {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPanelContainer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPanoramaSkyMaterial extends __NameMapMaterial {
    }
    /** A material that provides a special texture to a [Sky], usually an HDR panorama.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_panoramaskymaterial.html  
     */
    class PanoramaSkyMaterial extends Material {
        constructor(identifier?: any)
        /** [Texture2D] to be applied to the [PanoramaSkyMaterial]. */
        get panorama(): null | Texture2D
        set panorama(value: null | Texture2D)
        
        /** A boolean value to determine if the background texture should be filtered or not. */
        get filter(): boolean
        set filter(value: boolean)
        
        /** The sky's overall brightness multiplier. Higher values result in a brighter sky. */
        get energy_multiplier(): float64
        set energy_multiplier(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPanoramaSkyMaterial;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapParallax2D extends __NameMapNode2D {
    }
    /** A node used to create a parallax scrolling background.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_parallax2d.html  
     */
    class Parallax2D<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        _camera_moved(transform: Transform2D, screen_offset: Vector2, adj_screen_offset: Vector2): void
        
        /** Multiplier to the final [Parallax2D]'s offset. Can be used to simulate distance from the camera.  
         *  For example, a value of `1` scrolls at the same speed as the camera. A value greater than `1` scrolls faster, making objects appear closer. Less than `1` scrolls slower, making objects appear further, and a value of `0` stops the objects completely.  
         */
        get scroll_scale(): Vector2
        set scroll_scale(value: Vector2)
        
        /** The [Parallax2D]'s offset. Similar to [member screen_offset] and [member Node2D.position], but will not be overridden.  
         *      
         *  **Note:** Values will loop if [member repeat_size] is set higher than `0`.  
         */
        get scroll_offset(): Vector2
        set scroll_offset(value: Vector2)
        
        /** Repeats the [Texture2D] of each of this node's children and offsets them by this value. When scrolling, the node's position loops, giving the illusion of an infinite scrolling background if the values are larger than the screen size. If an axis is set to `0`, the [Texture2D] will not be repeated. */
        get repeat_size(): Vector2
        set repeat_size(value: Vector2)
        
        /** Velocity at which the offset scrolls automatically, in pixels per second. */
        get autoscroll(): Vector2
        set autoscroll(value: Vector2)
        
        /** Overrides the amount of times the texture repeats. Each texture copy spreads evenly from the original by [member repeat_size]. Useful for when zooming out with a camera. */
        get repeat_times(): int64
        set repeat_times(value: int64)
        
        /** Top-left limits for scrolling to begin. If the camera is outside of this limit, the [Parallax2D] stops scrolling. Must be lower than [member limit_end] minus the viewport size to work. */
        get limit_begin(): Vector2
        set limit_begin(value: Vector2)
        
        /** Bottom-right limits for scrolling to end. If the camera is outside of this limit, the [Parallax2D] will stop scrolling. Must be higher than [member limit_begin] and the viewport size combined to work. */
        get limit_end(): Vector2
        set limit_end(value: Vector2)
        
        /** If `true`, this [Parallax2D] is offset by the current camera's position. If the [Parallax2D] is in a [CanvasLayer] separate from the current camera, it may be desired to match the value with [member CanvasLayer.follow_viewport_enabled]. */
        get follow_viewport(): boolean
        set follow_viewport(value: boolean)
        
        /** If `true`, [Parallax2D]'s position is not affected by the position of the camera. */
        get ignore_camera_scroll(): boolean
        set ignore_camera_scroll(value: boolean)
        
        /** Offset used to scroll this [Parallax2D]. This value is updated automatically unless [member ignore_camera_scroll] is `true`. */
        get screen_offset(): Vector2
        set screen_offset(value: Vector2)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapParallax2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapParallaxBackground extends __NameMapCanvasLayer {
    }
    /** A node used to create a parallax scrolling background.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_parallaxbackground.html  
     */
    class ParallaxBackground<Map extends NodePathMap = any> extends CanvasLayer<Map> {
        constructor(identifier?: any)
        _camera_moved(_unnamed_arg0: Transform2D, _unnamed_arg1: Vector2, _unnamed_arg2: Vector2): void
        
        /** The ParallaxBackground's scroll value. Calculated automatically when using a [Camera2D], but can be used to manually manage scrolling when no camera is present. */
        get scroll_offset(): Vector2
        set scroll_offset(value: Vector2)
        
        /** The base position offset for all [ParallaxLayer] children. */
        get scroll_base_offset(): Vector2
        set scroll_base_offset(value: Vector2)
        
        /** The base motion scale for all [ParallaxLayer] children. */
        get scroll_base_scale(): Vector2
        set scroll_base_scale(value: Vector2)
        
        /** Top-left limits for scrolling to begin. If the camera is outside of this limit, the background will stop scrolling. Must be lower than [member scroll_limit_end] to work. */
        get scroll_limit_begin(): Vector2
        set scroll_limit_begin(value: Vector2)
        
        /** Bottom-right limits for scrolling to end. If the camera is outside of this limit, the background will stop scrolling. Must be higher than [member scroll_limit_begin] to work. */
        get scroll_limit_end(): Vector2
        set scroll_limit_end(value: Vector2)
        
        /** If `true`, elements in [ParallaxLayer] child aren't affected by the zoom level of the camera. */
        get scroll_ignore_camera_zoom(): boolean
        set scroll_ignore_camera_zoom(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapParallaxBackground;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapParallaxLayer extends __NameMapNode2D {
    }
    /** A parallax scrolling layer to be used with [ParallaxBackground].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_parallaxlayer.html  
     */
    class ParallaxLayer<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** Multiplies the ParallaxLayer's motion. If an axis is set to `0`, it will not scroll. */
        get motion_scale(): Vector2
        set motion_scale(value: Vector2)
        
        /** The ParallaxLayer's offset relative to the parent ParallaxBackground's [member ParallaxBackground.scroll_offset]. */
        get motion_offset(): Vector2
        set motion_offset(value: Vector2)
        
        /** The interval, in pixels, at which the [ParallaxLayer] is drawn repeatedly. Useful for creating an infinitely scrolling background. If an axis is set to `0`, the [ParallaxLayer] will be drawn only once along that direction.  
         *      
         *  **Note:** If you want the repetition to pixel-perfect match a [Texture2D] displayed by a child node, you should account for any scale applied to the texture when defining this interval. For example, if you use a child [Sprite2D] scaled to `0.5` to display a 600x600 texture, and want this sprite to be repeated continuously horizontally, you should set the mirroring to `Vector2(300, 0)`.  
         *      
         *  **Note:** If the length of the viewport axis is bigger than twice the repeated axis size, it will not repeat infinitely, as the parallax layer only draws 2 instances of the layer at any given time. The visibility window is calculated from the parent [ParallaxBackground]'s position, not the layer's own position. So, if you use mirroring, **do not** change the [ParallaxLayer] position relative to its parent. Instead, if you need to adjust the background's position, set the [member CanvasLayer.offset] property in the parent [ParallaxBackground].  
         *      
         *  **Note:** Despite the name, the layer will not be mirrored, it will only be repeated.  
         */
        get motion_mirroring(): Vector2
        set motion_mirroring(value: Vector2)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapParallaxLayer;
    }
    namespace ParticleProcessMaterial {
        enum Parameter {
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set initial velocity properties. */
            PARAM_INITIAL_LINEAR_VELOCITY = 0,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set angular velocity properties. */
            PARAM_ANGULAR_VELOCITY = 1,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set orbital velocity properties. */
            PARAM_ORBIT_VELOCITY = 2,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set linear acceleration properties. */
            PARAM_LINEAR_ACCEL = 3,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set radial acceleration properties. */
            PARAM_RADIAL_ACCEL = 4,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set tangential acceleration properties. */
            PARAM_TANGENTIAL_ACCEL = 5,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set damping properties. */
            PARAM_DAMPING = 6,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set angle properties. */
            PARAM_ANGLE = 7,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set scale properties. */
            PARAM_SCALE = 8,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set hue variation properties. */
            PARAM_HUE_VARIATION = 9,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set animation speed properties. */
            PARAM_ANIM_SPEED = 10,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set animation offset properties. */
            PARAM_ANIM_OFFSET = 11,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set radial velocity properties. */
            PARAM_RADIAL_VELOCITY = 15,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set directional velocity properties. */
            PARAM_DIRECTIONAL_VELOCITY = 16,
            
            /** Use with [method set_param_min], [method set_param_max], and [method set_param_texture] to set scale over velocity properties. */
            PARAM_SCALE_OVER_VELOCITY = 17,
            
            /** Represents the size of the [enum Parameter] enum. */
            PARAM_MAX = 18,
            
            /** Use with [method set_param_min] and [method set_param_max] to set the turbulence minimum und maximum influence on each particles velocity. */
            PARAM_TURB_VEL_INFLUENCE = 13,
            
            /** Use with [method set_param_min] and [method set_param_max] to set the turbulence minimum and maximum displacement of the particles spawn position. */
            PARAM_TURB_INIT_DISPLACEMENT = 14,
            
            /** Use with [method set_param_texture] to set the turbulence influence over the particles life time. */
            PARAM_TURB_INFLUENCE_OVER_LIFE = 12,
        }
        enum ParticleFlags {
            /** Use with [method set_particle_flag] to set [member particle_flag_align_y]. */
            PARTICLE_FLAG_ALIGN_Y_TO_VELOCITY = 0,
            
            /** Use with [method set_particle_flag] to set [member particle_flag_rotate_y]. */
            PARTICLE_FLAG_ROTATE_Y = 1,
            
            /** Use with [method set_particle_flag] to set [member particle_flag_disable_z]. */
            PARTICLE_FLAG_DISABLE_Z = 2,
            PARTICLE_FLAG_DAMPING_AS_FRICTION = 3,
            
            /** Represents the size of the [enum ParticleFlags] enum. */
            PARTICLE_FLAG_MAX = 4,
        }
        enum EmissionShape {
            /** All particles will be emitted from a single point. */
            EMISSION_SHAPE_POINT = 0,
            
            /** Particles will be emitted in the volume of a sphere. */
            EMISSION_SHAPE_SPHERE = 1,
            
            /** Particles will be emitted on the surface of a sphere. */
            EMISSION_SHAPE_SPHERE_SURFACE = 2,
            
            /** Particles will be emitted in the volume of a box. */
            EMISSION_SHAPE_BOX = 3,
            
            /** Particles will be emitted at a position determined by sampling a random point on the [member emission_point_texture]. Particle color will be modulated by [member emission_color_texture]. */
            EMISSION_SHAPE_POINTS = 4,
            
            /** Particles will be emitted at a position determined by sampling a random point on the [member emission_point_texture]. Particle velocity and rotation will be set based on [member emission_normal_texture]. Particle color will be modulated by [member emission_color_texture]. */
            EMISSION_SHAPE_DIRECTED_POINTS = 5,
            
            /** Particles will be emitted in a ring or cylinder. */
            EMISSION_SHAPE_RING = 6,
            
            /** Represents the size of the [enum EmissionShape] enum. */
            EMISSION_SHAPE_MAX = 7,
        }
        enum SubEmitterMode {
            SUB_EMITTER_DISABLED = 0,
            SUB_EMITTER_CONSTANT = 1,
            SUB_EMITTER_AT_END = 2,
            SUB_EMITTER_AT_COLLISION = 3,
            SUB_EMITTER_AT_START = 4,
            
            /** Represents the size of the [enum SubEmitterMode] enum. */
            SUB_EMITTER_MAX = 5,
        }
        enum CollisionMode {
            /** No collision for particles. Particles will go through [GPUParticlesCollision3D] nodes. */
            COLLISION_DISABLED = 0,
            
            /** [RigidBody3D]-style collision for particles using [GPUParticlesCollision3D] nodes. */
            COLLISION_RIGID = 1,
            
            /** Hide particles instantly when colliding with a [GPUParticlesCollision3D] node. This can be combined with a subemitter that uses the [constant COLLISION_RIGID] collision mode to "replace" the parent particle with the subemitter on impact. */
            COLLISION_HIDE_ON_CONTACT = 2,
            
            /** Represents the size of the [enum CollisionMode] enum. */
            COLLISION_MAX = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapParticleProcessMaterial extends __NameMapMaterial {
    }
    /** Holds a particle configuration for [GPUParticles2D] or [GPUParticles3D] nodes.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_particleprocessmaterial.html  
     */
    class ParticleProcessMaterial extends Material {
        constructor(identifier?: any)
        /** Sets the minimum and maximum values of the given [param param].  
         *  The `x` component of the argument vector corresponds to minimum and the `y` component corresponds to maximum.  
         */
        set_param(param: ParticleProcessMaterial.Parameter, value: Vector2): void
        
        /** Returns the minimum and maximum values of the given [param param] as a vector.  
         *  The `x` component of the returned vector corresponds to minimum and the `y` component corresponds to maximum.  
         */
        get_param(param: ParticleProcessMaterial.Parameter): Vector2
        
        /** Sets the minimum value range for the given parameter. */
        set_param_min(param: ParticleProcessMaterial.Parameter, value: float64): void
        
        /** Returns the minimum value range for the given parameter. */
        get_param_min(param: ParticleProcessMaterial.Parameter): float64
        
        /** Sets the maximum value range for the given parameter. */
        set_param_max(param: ParticleProcessMaterial.Parameter, value: float64): void
        
        /** Returns the maximum value range for the given parameter. */
        get_param_max(param: ParticleProcessMaterial.Parameter): float64
        
        /** Sets the [Texture2D] for the specified [enum Parameter]. */
        set_param_texture(param: ParticleProcessMaterial.Parameter, texture: Texture2D): void
        
        /** Returns the [Texture2D] used by the specified parameter. */
        get_param_texture(param: ParticleProcessMaterial.Parameter): null | Texture2D
        
        /** Sets the [param particle_flag] to [param enable]. */
        set_particle_flag(particle_flag: ParticleProcessMaterial.ParticleFlags, enable: boolean): void
        
        /** Returns `true` if the specified particle flag is enabled. */
        get_particle_flag(particle_flag: ParticleProcessMaterial.ParticleFlags): boolean
        
        /** Particle lifetime randomness ratio. The equation for the lifetime of a particle is `lifetime * (1.0 - randf() * lifetime_randomness)`. For example, a [member lifetime_randomness] of `0.4` scales the lifetime between `0.6` to `1.0` of its original value. */
        get lifetime_randomness(): float64
        set lifetime_randomness(value: float64)
        
        /** Align Y axis of particle with the direction of its velocity. */
        get particle_flag_align_y(): boolean
        set particle_flag_align_y(value: boolean)
        
        /** If `true`, particles rotate around Y axis by [member angle_min]. */
        get particle_flag_rotate_y(): boolean
        set particle_flag_rotate_y(value: boolean)
        
        /** If `true`, particles will not move on the z axis. */
        get particle_flag_disable_z(): boolean
        set particle_flag_disable_z(value: boolean)
        
        /** Changes the behavior of the damping properties from a linear deceleration to a deceleration based on speed percentage. */
        get particle_flag_damping_as_friction(): boolean
        set particle_flag_damping_as_friction(value: boolean)
        
        /** The offset for the [member emission_shape], in local space. */
        get emission_shape_offset(): Vector3
        set emission_shape_offset(value: Vector3)
        
        /** The scale of the [member emission_shape], in local space. */
        get emission_shape_scale(): Vector3
        set emission_shape_scale(value: Vector3)
        
        /** Particles will be emitted inside this region. */
        get emission_shape(): int64
        set emission_shape(value: int64)
        
        /** The sphere's radius if [member emission_shape] is set to [constant EMISSION_SHAPE_SPHERE]. */
        get emission_sphere_radius(): float64
        set emission_sphere_radius(value: float64)
        
        /** The box's extents if [member emission_shape] is set to [constant EMISSION_SHAPE_BOX].  
         *      
         *  **Note:** [member emission_box_extents] starts from the center point and applies the X, Y, and Z values in both directions. The size is twice the area of the extents.  
         */
        get emission_box_extents(): Vector3
        set emission_box_extents(value: Vector3)
        
        /** Particles will be emitted at positions determined by sampling this texture at a random position. Used with [constant EMISSION_SHAPE_POINTS] and [constant EMISSION_SHAPE_DIRECTED_POINTS]. Can be created automatically from mesh or node by selecting "Create Emission Points from Mesh/Node" under the "Particles" tool in the toolbar. */
        get emission_point_texture(): null | Texture2D
        set emission_point_texture(value: null | Texture2D)
        
        /** Particle velocity and rotation will be set by sampling this texture at the same point as the [member emission_point_texture]. Used only in [constant EMISSION_SHAPE_DIRECTED_POINTS]. Can be created automatically from mesh or node by selecting "Create Emission Points from Mesh/Node" under the "Particles" tool in the toolbar. */
        get emission_normal_texture(): null | Texture2D
        set emission_normal_texture(value: null | Texture2D)
        
        /** Particle color will be modulated by color determined by sampling this texture at the same point as the [member emission_point_texture].  
         *      
         *  **Note:** [member emission_color_texture] multiplies the particle mesh's vertex colors. To have a visible effect on a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo]  *must*  be `true`. For a [ShaderMaterial], `ALBEDO *= COLOR.rgb;` must be inserted in the shader's `fragment()` function. Otherwise, [member emission_color_texture] will have no visible effect.  
         */
        get emission_color_texture(): null | Texture2D
        set emission_color_texture(value: null | Texture2D)
        
        /** The number of emission points if [member emission_shape] is set to [constant EMISSION_SHAPE_POINTS] or [constant EMISSION_SHAPE_DIRECTED_POINTS]. */
        get emission_point_count(): int64
        set emission_point_count(value: int64)
        
        /** The axis of the ring when using the emitter [constant EMISSION_SHAPE_RING]. */
        get emission_ring_axis(): Vector3
        set emission_ring_axis(value: Vector3)
        
        /** The height of the ring when using the emitter [constant EMISSION_SHAPE_RING]. */
        get emission_ring_height(): float64
        set emission_ring_height(value: float64)
        
        /** The radius of the ring when using the emitter [constant EMISSION_SHAPE_RING]. */
        get emission_ring_radius(): float64
        set emission_ring_radius(value: float64)
        
        /** The inner radius of the ring when using the emitter [constant EMISSION_SHAPE_RING]. */
        get emission_ring_inner_radius(): float64
        set emission_ring_inner_radius(value: float64)
        
        /** The angle of the cone when using the emitter [constant EMISSION_SHAPE_RING]. The default angle of 90 degrees results in a ring, while an angle of 0 degrees results in a cone. Intermediate values will result in a ring where one end is larger than the other.  
         *      
         *  **Note:** Depending on [member emission_ring_height], the angle may be clamped if the ring's end is reached to form a perfect cone.  
         */
        get emission_ring_cone_angle(): float64
        set emission_ring_cone_angle(value: float64)
        get angle(): Vector2
        set angle(value: Vector2)
        
        /** Minimum equivalent of [member angle_max]. */
        get angle_min(): float64
        set angle_min(value: float64)
        
        /** Maximum initial rotation applied to each particle, in degrees.  
         *  Only applied when [member particle_flag_disable_z] or [member particle_flag_rotate_y] are `true` or the [BaseMaterial3D] being used to draw the particle is using [constant BaseMaterial3D.BILLBOARD_PARTICLES].  
         */
        get angle_max(): float64
        set angle_max(value: float64)
        
        /** Each particle's rotation will be animated along this [CurveTexture]. */
        get angle_curve(): null | CurveTexture
        set angle_curve(value: null | CurveTexture)
        
        /** Percentage of the velocity of the respective [GPUParticles2D] or [GPUParticles3D] inherited by each particle when spawning. */
        get inherit_velocity_ratio(): float64
        set inherit_velocity_ratio(value: float64)
        
        /** A pivot point used to calculate radial and orbital velocity of particles. */
        get velocity_pivot(): Vector3
        set velocity_pivot(value: Vector3)
        
        /** Unit vector specifying the particles' emission direction. */
        get direction(): Vector3
        set direction(value: Vector3)
        
        /** Each particle's initial direction range from `+spread` to `-spread` degrees. */
        get spread(): float64
        set spread(value: float64)
        
        /** Amount of [member spread] along the Y axis. */
        get flatness(): float64
        set flatness(value: float64)
        get initial_velocity(): Vector2
        set initial_velocity(value: Vector2)
        
        /** Minimum equivalent of [member initial_velocity_max]. */
        get initial_velocity_min(): float64
        set initial_velocity_min(value: float64)
        
        /** Maximum initial velocity magnitude for each particle. Direction comes from [member direction] and [member spread]. */
        get initial_velocity_max(): float64
        set initial_velocity_max(value: float64)
        get angular_velocity(): Vector2
        set angular_velocity(value: Vector2)
        
        /** Minimum equivalent of [member angular_velocity_max]. */
        get angular_velocity_min(): float64
        set angular_velocity_min(value: float64)
        
        /** Maximum initial angular velocity (rotation speed) applied to each particle in  *degrees*  per second.  
         *  Only applied when [member particle_flag_disable_z] or [member particle_flag_rotate_y] are `true` or the [BaseMaterial3D] being used to draw the particle is using [constant BaseMaterial3D.BILLBOARD_PARTICLES].  
         */
        get angular_velocity_max(): float64
        set angular_velocity_max(value: float64)
        
        /** Each particle's angular velocity (rotation speed) will vary along this [CurveTexture] over its lifetime. */
        get angular_velocity_curve(): null | CurveTexture
        set angular_velocity_curve(value: null | CurveTexture)
        get directional_velocity(): Vector2
        set directional_velocity(value: Vector2)
        
        /** Minimum directional velocity value, which is multiplied by [member directional_velocity_curve].  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get directional_velocity_min(): float64
        set directional_velocity_min(value: float64)
        
        /** Maximum directional velocity value, which is multiplied by [member directional_velocity_curve].  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get directional_velocity_max(): float64
        set directional_velocity_max(value: float64)
        
        /** A curve that specifies the velocity along each of the axes of the particle system along its lifetime.  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get directional_velocity_curve(): null | CurveXYZTexture
        set directional_velocity_curve(value: null | CurveXYZTexture)
        get orbit_velocity(): Vector2
        set orbit_velocity(value: Vector2)
        
        /** Minimum equivalent of [member orbit_velocity_max].  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get orbit_velocity_min(): float64
        set orbit_velocity_min(value: float64)
        
        /** Maximum orbital velocity applied to each particle. Makes the particles circle around origin. Specified in number of full rotations around origin per second.  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get orbit_velocity_max(): float64
        set orbit_velocity_max(value: float64)
        
        /** Each particle's orbital velocity will vary along this [CurveTexture].  
         *      
         *  **Note:** For 3D orbital velocity, use a [CurveXYZTexture].  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get orbit_velocity_curve(): null | CurveTexture | CurveXYZTexture
        set orbit_velocity_curve(value: null | CurveTexture | CurveXYZTexture)
        get radial_velocity(): Vector2
        set radial_velocity(value: Vector2)
        
        /** Minimum radial velocity applied to each particle. Makes particles move away from the [member velocity_pivot], or toward it if negative.  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get radial_velocity_min(): float64
        set radial_velocity_min(value: float64)
        
        /** Maximum radial velocity applied to each particle. Makes particles move away from the [member velocity_pivot], or toward it if negative.  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get radial_velocity_max(): float64
        set radial_velocity_max(value: float64)
        
        /** A [CurveTexture] that defines the velocity over the particle's lifetime away (or toward) the [member velocity_pivot].  
         *      
         *  **Note:** Animated velocities will not be affected by damping, use [member velocity_limit_curve] instead.  
         */
        get radial_velocity_curve(): null | CurveTexture
        set radial_velocity_curve(value: null | CurveTexture)
        
        /** A [CurveTexture] that defines the maximum velocity of a particle during its lifetime. */
        get velocity_limit_curve(): null | CurveTexture
        set velocity_limit_curve(value: null | CurveTexture)
        
        /** Gravity applied to every particle. */
        get gravity(): Vector3
        set gravity(value: Vector3)
        get linear_accel(): Vector2
        set linear_accel(value: Vector2)
        
        /** Minimum equivalent of [member linear_accel_max]. */
        get linear_accel_min(): float64
        set linear_accel_min(value: float64)
        
        /** Maximum linear acceleration applied to each particle in the direction of motion. */
        get linear_accel_max(): float64
        set linear_accel_max(value: float64)
        
        /** Each particle's linear acceleration will vary along this [CurveTexture]. */
        get linear_accel_curve(): null | CurveTexture
        set linear_accel_curve(value: null | CurveTexture)
        get radial_accel(): Vector2
        set radial_accel(value: Vector2)
        
        /** Minimum equivalent of [member radial_accel_max]. */
        get radial_accel_min(): float64
        set radial_accel_min(value: float64)
        
        /** Maximum radial acceleration applied to each particle. Makes particle accelerate away from the origin or towards it if negative. */
        get radial_accel_max(): float64
        set radial_accel_max(value: float64)
        
        /** Each particle's radial acceleration will vary along this [CurveTexture]. */
        get radial_accel_curve(): null | CurveTexture
        set radial_accel_curve(value: null | CurveTexture)
        get tangential_accel(): Vector2
        set tangential_accel(value: Vector2)
        
        /** Minimum equivalent of [member tangential_accel_max]. */
        get tangential_accel_min(): float64
        set tangential_accel_min(value: float64)
        
        /** Maximum tangential acceleration applied to each particle. Tangential acceleration is perpendicular to the particle's velocity giving the particles a swirling motion. */
        get tangential_accel_max(): float64
        set tangential_accel_max(value: float64)
        
        /** Each particle's tangential acceleration will vary along this [CurveTexture]. */
        get tangential_accel_curve(): null | CurveTexture
        set tangential_accel_curve(value: null | CurveTexture)
        get damping(): Vector2
        set damping(value: Vector2)
        
        /** Minimum equivalent of [member damping_max]. */
        get damping_min(): float64
        set damping_min(value: float64)
        
        /** The maximum rate at which particles lose velocity. For example value of `100` means that the particle will go from `100` velocity to `0` in `1` second. */
        get damping_max(): float64
        set damping_max(value: float64)
        
        /** Damping will vary along this [CurveTexture]. */
        get damping_curve(): null | CurveTexture
        set damping_curve(value: null | CurveTexture)
        
        /** If `true`, interaction with particle attractors is enabled. In 3D, attraction only occurs within the area defined by the [GPUParticles3D] node's [member GPUParticles3D.visibility_aabb]. */
        get attractor_interaction_enabled(): boolean
        set attractor_interaction_enabled(value: boolean)
        get scale(): Vector2
        set scale(value: Vector2)
        
        /** Minimum equivalent of [member scale_max]. */
        get scale_min(): float64
        set scale_min(value: float64)
        
        /** Maximum initial scale applied to each particle. */
        get scale_max(): float64
        set scale_max(value: float64)
        
        /** Each particle's scale will vary along this [CurveTexture] over its lifetime. If a [CurveXYZTexture] is supplied instead, the scale will be separated per-axis. */
        get scale_curve(): null | CurveTexture | CurveXYZTexture
        set scale_curve(value: null | CurveTexture | CurveXYZTexture)
        get scale_over_velocity(): Vector2
        set scale_over_velocity(value: Vector2)
        
        /** Minimum velocity value reference for [member scale_over_velocity_curve].  
         *  [member scale_over_velocity_curve] will be interpolated between [member scale_over_velocity_min] and [member scale_over_velocity_max].  
         */
        get scale_over_velocity_min(): float64
        set scale_over_velocity_min(value: float64)
        
        /** Maximum velocity value reference for [member scale_over_velocity_curve].  
         *  [member scale_over_velocity_curve] will be interpolated between [member scale_over_velocity_min] and [member scale_over_velocity_max].  
         */
        get scale_over_velocity_max(): float64
        set scale_over_velocity_max(value: float64)
        
        /** Either a [CurveTexture] or a [CurveXYZTexture] that scales each particle based on its velocity. */
        get scale_over_velocity_curve(): null | CurveTexture | CurveXYZTexture
        set scale_over_velocity_curve(value: null | CurveTexture | CurveXYZTexture)
        
        /** Each particle's initial color. If the [GPUParticles2D]'s `texture` is defined, it will be multiplied by this color.  
         *      
         *  **Note:** [member color] multiplies the particle mesh's vertex colors. To have a visible effect on a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo]  *must*  be `true`. For a [ShaderMaterial], `ALBEDO *= COLOR.rgb;` must be inserted in the shader's `fragment()` function. Otherwise, [member color] will have no visible effect.  
         */
        get color(): Color
        set color(value: Color)
        
        /** Each particle's color will vary along this [GradientTexture1D] over its lifetime (multiplied with [member color]).  
         *      
         *  **Note:** [member color_ramp] multiplies the particle mesh's vertex colors. To have a visible effect on a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo]  *must*  be `true`. For a [ShaderMaterial], `ALBEDO *= COLOR.rgb;` must be inserted in the shader's `fragment()` function. Otherwise, [member color_ramp] will have no visible effect.  
         */
        get color_ramp(): null | GradientTexture1D
        set color_ramp(value: null | GradientTexture1D)
        
        /** Each particle's initial color will vary along this [GradientTexture1D] (multiplied with [member color]).  
         *      
         *  **Note:** [member color_initial_ramp] multiplies the particle mesh's vertex colors. To have a visible effect on a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo]  *must*  be `true`. For a [ShaderMaterial], `ALBEDO *= COLOR.rgb;` must be inserted in the shader's `fragment()` function. Otherwise, [member color_initial_ramp] will have no visible effect.  
         */
        get color_initial_ramp(): null | GradientTexture1D
        set color_initial_ramp(value: null | GradientTexture1D)
        
        /** The alpha value of each particle's color will be multiplied by this [CurveTexture] over its lifetime.  
         *      
         *  **Note:** [member alpha_curve] multiplies the particle mesh's vertex colors. To have a visible effect on a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo]  *must*  be `true`. For a [ShaderMaterial], `ALPHA *= COLOR.a;` must be inserted in the shader's `fragment()` function. Otherwise, [member alpha_curve] will have no visible effect.  
         */
        get alpha_curve(): null | CurveTexture
        set alpha_curve(value: null | CurveTexture)
        
        /** Each particle's color will be multiplied by this [CurveTexture] over its lifetime.  
         *      
         *  **Note:** [member emission_curve] multiplies the particle mesh's vertex colors. To have a visible effect on a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo]  *must*  be `true`. For a [ShaderMaterial], `ALBEDO *= COLOR.rgb;` must be inserted in the shader's `fragment()` function. Otherwise, [member emission_curve] will have no visible effect.  
         */
        get emission_curve(): null | CurveTexture
        set emission_curve(value: null | CurveTexture)
        get hue_variation(): Vector2
        set hue_variation(value: Vector2)
        
        /** Minimum equivalent of [member hue_variation_max]. */
        get hue_variation_min(): float64
        set hue_variation_min(value: float64)
        
        /** Maximum initial hue variation applied to each particle. It will shift the particle color's hue. */
        get hue_variation_max(): float64
        set hue_variation_max(value: float64)
        
        /** Each particle's hue will vary along this [CurveTexture]. */
        get hue_variation_curve(): null | CurveTexture
        set hue_variation_curve(value: null | CurveTexture)
        get anim_speed(): Vector2
        set anim_speed(value: Vector2)
        
        /** Minimum equivalent of [member anim_speed_max]. */
        get anim_speed_min(): float64
        set anim_speed_min(value: float64)
        
        /** Maximum particle animation speed. Animation speed of `1` means that the particles will make full `0` to `1` offset cycle during lifetime, `2` means `2` cycles etc.  
         *  With animation speed greater than `1`, remember to enable [member CanvasItemMaterial.particles_anim_loop] property if you want the animation to repeat.  
         */
        get anim_speed_max(): float64
        set anim_speed_max(value: float64)
        
        /** Each particle's animation speed will vary along this [CurveTexture]. */
        get anim_speed_curve(): null | CurveTexture
        set anim_speed_curve(value: null | CurveTexture)
        get anim_offset(): Vector2
        set anim_offset(value: Vector2)
        
        /** Minimum equivalent of [member anim_offset_max]. */
        get anim_offset_min(): float64
        set anim_offset_min(value: float64)
        
        /** Maximum animation offset that corresponds to frame index in the texture. `0` is the first frame, `1` is the last one. See [member CanvasItemMaterial.particles_animation]. */
        get anim_offset_max(): float64
        set anim_offset_max(value: float64)
        
        /** Each particle's animation offset will vary along this [CurveTexture]. */
        get anim_offset_curve(): null | CurveTexture
        set anim_offset_curve(value: null | CurveTexture)
        
        /** If `true`, enables turbulence for the particle system. Turbulence can be used to vary particle movement according to its position (based on a 3D noise pattern). In 3D, [GPUParticlesAttractorVectorField3D] with [NoiseTexture3D] can be used as an alternative to turbulence that works in world space and with multiple particle systems reacting in the same way.  
         *      
         *  **Note:** Enabling turbulence has a high performance cost on the GPU. Only enable turbulence on a few particle systems at once at most, and consider disabling it when targeting mobile/web platforms.  
         */
        get turbulence_enabled(): boolean
        set turbulence_enabled(value: boolean)
        
        /** The turbulence noise strength. Increasing this will result in a stronger, more contrasting, flow pattern. */
        get turbulence_noise_strength(): float64
        set turbulence_noise_strength(value: float64)
        
        /** This value controls the overall scale/frequency of the turbulence noise pattern.  
         *  A small scale will result in smaller features with more detail while a high scale will result in smoother noise with larger features.  
         */
        get turbulence_noise_scale(): float64
        set turbulence_noise_scale(value: float64)
        
        /** A scrolling velocity for the turbulence field. This sets a directional trend for the pattern to move in over time.  
         *  The default value of `Vector3(0, 0, 0)` turns off the scrolling.  
         */
        get turbulence_noise_speed(): Vector3
        set turbulence_noise_speed(value: Vector3)
        
        /** The in-place rate of change of the turbulence field. This defines how quickly the noise pattern varies over time.  
         *  A value of 0.0 will result in a fixed pattern.  
         */
        get turbulence_noise_speed_random(): float64
        set turbulence_noise_speed_random(value: float64)
        get turbulence_influence(): Vector2
        set turbulence_influence(value: Vector2)
        
        /** Minimum turbulence influence on each particle.  
         *  The actual amount of turbulence influence on each particle is calculated as a random value between [member turbulence_influence_min] and [member turbulence_influence_max] and multiplied by the amount of turbulence influence from [member turbulence_influence_over_life].  
         */
        get turbulence_influence_min(): float64
        set turbulence_influence_min(value: float64)
        
        /** Maximum turbulence influence on each particle.  
         *  The actual amount of turbulence influence on each particle is calculated as a random value between [member turbulence_influence_min] and [member turbulence_influence_max] and multiplied by the amount of turbulence influence from [member turbulence_influence_over_life].  
         */
        get turbulence_influence_max(): float64
        set turbulence_influence_max(value: float64)
        get turbulence_initial_displacement(): Vector2
        set turbulence_initial_displacement(value: Vector2)
        
        /** Minimum displacement of each particle's spawn position by the turbulence.  
         *  The actual amount of displacement will be a factor of the underlying turbulence multiplied by a random value between [member turbulence_initial_displacement_min] and [member turbulence_initial_displacement_max].  
         */
        get turbulence_initial_displacement_min(): float64
        set turbulence_initial_displacement_min(value: float64)
        
        /** Maximum displacement of each particle's spawn position by the turbulence.  
         *  The actual amount of displacement will be a factor of the underlying turbulence multiplied by a random value between [member turbulence_initial_displacement_min] and [member turbulence_initial_displacement_max].  
         */
        get turbulence_initial_displacement_max(): float64
        set turbulence_initial_displacement_max(value: float64)
        
        /** Each particle's amount of turbulence will be influenced along this [CurveTexture] over its life time. */
        get turbulence_influence_over_life(): null | CurveTexture
        set turbulence_influence_over_life(value: null | CurveTexture)
        
        /** The particles' collision mode.  
         *      
         *  **Note:** 3D Particles can only collide with [GPUParticlesCollision3D] nodes, not [PhysicsBody3D] nodes. To make particles collide with various objects, you can add [GPUParticlesCollision3D] nodes as children of [PhysicsBody3D] nodes. In 3D, collisions only occur within the area defined by the [GPUParticles3D] node's [member GPUParticles3D.visibility_aabb].  
         *      
         *  **Note:** 2D Particles can only collide with [LightOccluder2D] nodes, not [PhysicsBody2D] nodes.  
         */
        get collision_mode(): int64
        set collision_mode(value: int64)
        
        /** The particles' friction. Values range from `0` (frictionless) to `1` (maximum friction). Only effective if [member collision_mode] is [constant COLLISION_RIGID]. */
        get collision_friction(): float64
        set collision_friction(value: float64)
        
        /** The particles' bounciness. Values range from `0` (no bounce) to `1` (full bounciness). Only effective if [member collision_mode] is [constant COLLISION_RIGID]. */
        get collision_bounce(): float64
        set collision_bounce(value: float64)
        
        /** If `true`, [member GPUParticles3D.collision_base_size] is multiplied by the particle's effective scale (see [member scale_min], [member scale_max], [member scale_curve], and [member scale_over_velocity_curve]). */
        get collision_use_scale(): boolean
        set collision_use_scale(value: boolean)
        
        /** The particle subemitter mode (see [member GPUParticles2D.sub_emitter] and [member GPUParticles3D.sub_emitter]). */
        get sub_emitter_mode(): int64
        set sub_emitter_mode(value: int64)
        
        /** The frequency at which particles should be emitted from the subemitter node. One particle will be spawned every [member sub_emitter_frequency] seconds.  
         *      
         *  **Note:** This value shouldn't exceed [member GPUParticles2D.amount] or [member GPUParticles3D.amount] defined on the  *subemitter node*  (not the main node), relative to the subemitter's particle lifetime. If the number of particles is exceeded, no new particles will spawn from the subemitter until enough particles have expired.  
         */
        get sub_emitter_frequency(): float64
        set sub_emitter_frequency(value: float64)
        
        /** The amount of particles to spawn from the subemitter node when the particle expires.  
         *      
         *  **Note:** This value shouldn't exceed [member GPUParticles2D.amount] or [member GPUParticles3D.amount] defined on the  *subemitter node*  (not the main node), relative to the subemitter's particle lifetime. If the number of particles is exceeded, no new particles will spawn from the subemitter until enough particles have expired.  
         */
        get sub_emitter_amount_at_end(): int64
        set sub_emitter_amount_at_end(value: int64)
        
        /** The amount of particles to spawn from the subemitter node when a collision occurs. When combined with [constant COLLISION_HIDE_ON_CONTACT] on the main particles material, this can be used to achieve effects such as raindrops hitting the ground.  
         *      
         *  **Note:** This value shouldn't exceed [member GPUParticles2D.amount] or [member GPUParticles3D.amount] defined on the  *subemitter node*  (not the main node), relative to the subemitter's particle lifetime. If the number of particles is exceeded, no new particles will spawn from the subemitter until enough particles have expired.  
         */
        get sub_emitter_amount_at_collision(): int64
        set sub_emitter_amount_at_collision(value: int64)
        
        /** The amount of particles to spawn from the subemitter node when the particle spawns.  
         *      
         *  **Note:** This value shouldn't exceed [member GPUParticles2D.amount] or [member GPUParticles3D.amount] defined on the  *subemitter node*  (not the main node), relative to the subemitter's particle lifetime. If the number of particles is exceeded, no new particles will spawn from the subemitter until enough particles have expired.  
         */
        get sub_emitter_amount_at_start(): int64
        set sub_emitter_amount_at_start(value: int64)
        
        /** If `true`, the subemitter inherits the parent particle's velocity when it spawns. */
        get sub_emitter_keep_velocity(): boolean
        set sub_emitter_keep_velocity(value: boolean)
        
        /** Emitted when this material's emission shape is changed in any way. This includes changes to [member emission_shape], [member emission_shape_scale], or [member emission_sphere_radius], and any other property that affects the emission shape's offset, size, scale, or orientation.  
         *      
         *  **Note:** This signal is only emitted inside the editor for performance reasons.  
         */
        readonly emission_shape_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapParticleProcessMaterial;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPath2D extends __NameMapNode2D {
    }
    /** Contains a [Curve2D] path for [PathFollow2D] nodes to follow.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_path2d.html  
     */
    class Path2D<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** A [Curve2D] describing the path. */
        get curve(): null | Curve2D
        set curve(value: null | Curve2D)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPath2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPath3D extends __NameMapNode3D {
    }
    /** Contains a [Curve3D] path for [PathFollow3D] nodes to follow.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_path3d.html  
     */
    class Path3D<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** A [Curve3D] describing the path. */
        get curve(): null | Curve3D
        set curve(value: null | Curve3D)
        
        /** The custom color used to draw the path in the editor. If set to [constant Color.BLACK] (as by default), the color set in [member ProjectSettings.debug/shapes/paths/geometry_color] is used. */
        get debug_custom_color(): Color
        set debug_custom_color(value: Color)
        
        /** Emitted when the [member curve] changes. */
        readonly curve_changed: Signal<() => void>
        
        /** Emitted when the [member debug_custom_color] changes. */
        readonly debug_color_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPath3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPathFollow2D extends __NameMapNode2D {
    }
    /** Point sampler for a [Path2D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_pathfollow2d.html  
     */
    class PathFollow2D<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** The distance along the path, in pixels. Changing this value sets this node's position to a point within the path. */
        get progress(): float64
        set progress(value: float64)
        
        /** The distance along the path as a number in the range 0.0 (for the first vertex) to 1.0 (for the last). This is just another way of expressing the progress within the path, as the offset supplied is multiplied internally by the path's length.  
         *  It can be set or get only if the [PathFollow2D] is the child of a [Path2D] which is part of the scene tree, and that this [Path2D] has a [Curve2D] with a non-zero length. Otherwise, trying to set this field will print an error, and getting this field will return `0.0`.  
         */
        get progress_ratio(): float64
        set progress_ratio(value: float64)
        
        /** The node's offset along the curve. */
        get h_offset(): float64
        set h_offset(value: float64)
        
        /** The node's offset perpendicular to the curve. */
        get v_offset(): float64
        set v_offset(value: float64)
        
        /** If `true`, this node rotates to follow the path, with the +X direction facing forward on the path. */
        get rotates(): boolean
        set rotates(value: boolean)
        
        /** If `true`, the position between two cached points is interpolated cubically, and linearly otherwise.  
         *  The points along the [Curve2D] of the [Path2D] are precomputed before use, for faster calculations. The point at the requested offset is then calculated interpolating between two adjacent cached points. This may present a problem if the curve makes sharp turns, as the cached points may not follow the curve closely enough.  
         *  There are two answers to this problem: either increase the number of cached points and increase memory consumption, or make a cubic interpolation between two points at the cost of (slightly) slower calculations.  
         */
        get cubic_interp(): boolean
        set cubic_interp(value: boolean)
        
        /** If `true`, any offset outside the path's length will wrap around, instead of stopping at the ends. Use it for cyclic paths. */
        get loop(): boolean
        set loop(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPathFollow2D;
    }
    namespace PathFollow3D {
        enum RotationMode {
            /** Forbids the PathFollow3D to rotate. */
            ROTATION_NONE = 0,
            
            /** Allows the PathFollow3D to rotate in the Y axis only. */
            ROTATION_Y = 1,
            
            /** Allows the PathFollow3D to rotate in both the X, and Y axes. */
            ROTATION_XY = 2,
            
            /** Allows the PathFollow3D to rotate in any axis. */
            ROTATION_XYZ = 3,
            
            /** Uses the up vector information in a [Curve3D] to enforce orientation. This rotation mode requires the [Path3D]'s [member Curve3D.up_vector_enabled] property to be set to `true`. */
            ROTATION_ORIENTED = 4,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPathFollow3D extends __NameMapNode3D {
    }
    /** Point sampler for a [Path3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_pathfollow3d.html  
     */
    class PathFollow3D<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Correct the [param transform]. [param rotation_mode] implicitly specifies how posture (forward, up and sideway direction) is calculated. */
        static correct_posture(transform: Transform3D, rotation_mode: PathFollow3D.RotationMode): Transform3D
        
        /** The distance from the first vertex, measured in 3D units along the path. Changing this value sets this node's position to a point within the path. */
        get progress(): float64
        set progress(value: float64)
        
        /** The distance from the first vertex, considering 0.0 as the first vertex and 1.0 as the last. This is just another way of expressing the progress within the path, as the progress supplied is multiplied internally by the path's length.  
         *  It can be set or get only if the [PathFollow3D] is the child of a [Path3D] which is part of the scene tree, and that this [Path3D] has a [Curve3D] with a non-zero length. Otherwise, trying to set this field will print an error, and getting this field will return `0.0`.  
         */
        get progress_ratio(): float64
        set progress_ratio(value: float64)
        
        /** The node's offset along the curve. */
        get h_offset(): float64
        set h_offset(value: float64)
        
        /** The node's offset perpendicular to the curve. */
        get v_offset(): float64
        set v_offset(value: float64)
        
        /** Allows or forbids rotation on one or more axes, depending on the [enum RotationMode] constants being used. */
        get rotation_mode(): int64
        set rotation_mode(value: int64)
        
        /** If `true`, the node moves on the travel path with orienting the +Z axis as forward. See also [constant Vector3.FORWARD] and [constant Vector3.MODEL_FRONT]. */
        get use_model_front(): boolean
        set use_model_front(value: boolean)
        
        /** If `true`, the position between two cached points is interpolated cubically, and linearly otherwise.  
         *  The points along the [Curve3D] of the [Path3D] are precomputed before use, for faster calculations. The point at the requested offset is then calculated interpolating between two adjacent cached points. This may present a problem if the curve makes sharp turns, as the cached points may not follow the curve closely enough.  
         *  There are two answers to this problem: either increase the number of cached points and increase memory consumption, or make a cubic interpolation between two points at the cost of (slightly) slower calculations.  
         */
        get cubic_interp(): boolean
        set cubic_interp(value: boolean)
        
        /** If `true`, any offset outside the path's length will wrap around, instead of stopping at the ends. Use it for cyclic paths. */
        get loop(): boolean
        set loop(value: boolean)
        
        /** If `true`, the tilt property of [Curve3D] takes effect. */
        get tilt_enabled(): boolean
        set tilt_enabled(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPathFollow3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicalBone2D extends __NameMapRigidBody2D {
    }
    /** A [RigidBody2D]-derived node used to make [Bone2D]s in a [Skeleton2D] react to physics.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicalbone2d.html  
     */
    class PhysicalBone2D<Map extends NodePathMap = any> extends RigidBody2D<Map> {
        constructor(identifier?: any)
        /** Returns the first [Joint2D] child node, if one exists. This is mainly a helper function to make it easier to get the [Joint2D] that the [PhysicalBone2D] is autoconfiguring. */
        get_joint(): null | Joint2D
        
        /** Returns a boolean that indicates whether the [PhysicalBone2D] is running and simulating using the Godot 2D physics engine. When `true`, the PhysicalBone2D node is using physics. */
        is_simulating_physics(): boolean
        
        /** The [NodePath] to the [Bone2D] that this [PhysicalBone2D] should simulate. */
        get bone2d_nodepath(): NodePath
        set bone2d_nodepath(value: NodePath | string)
        
        /** The index of the [Bone2D] that this [PhysicalBone2D] should simulate. */
        get bone2d_index(): int64
        set bone2d_index(value: int64)
        
        /** If `true`, the [PhysicalBone2D] will automatically configure the first [Joint2D] child node. The automatic configuration is limited to setting up the node properties and positioning the [Joint2D]. */
        get auto_configure_joint(): boolean
        set auto_configure_joint(value: boolean)
        
        /** If `true`, the [PhysicalBone2D] will start simulating using physics. If `false`, the [PhysicalBone2D] will follow the transform of the [Bone2D] node.  
         *      
         *  **Note:** To have the [Bone2D]s visually follow the [PhysicalBone2D], use a [SkeletonModification2DPhysicalBones] modification on the [Skeleton2D] node with the [Bone2D] nodes.  
         */
        get simulate_physics(): boolean
        set simulate_physics(value: boolean)
        
        /** If `true`, the [PhysicalBone2D] will keep the transform of the bone it is bound to when simulating physics. */
        get follow_bone_when_simulating(): boolean
        set follow_bone_when_simulating(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicalBone2D;
    }
    namespace PhysicalBone3D {
        enum DampMode {
            /** In this mode, the body's damping value is added to any value set in areas or the default value. */
            DAMP_MODE_COMBINE = 0,
            
            /** In this mode, the body's damping value replaces any value set in areas or the default value. */
            DAMP_MODE_REPLACE = 1,
        }
        enum JointType {
            /** No joint is applied to the PhysicsBone3D. */
            JOINT_TYPE_NONE = 0,
            
            /** A pin joint is applied to the PhysicsBone3D. */
            JOINT_TYPE_PIN = 1,
            
            /** A cone joint is applied to the PhysicsBone3D. */
            JOINT_TYPE_CONE = 2,
            
            /** A hinge joint is applied to the PhysicsBone3D. */
            JOINT_TYPE_HINGE = 3,
            
            /** A slider joint is applied to the PhysicsBone3D. */
            JOINT_TYPE_SLIDER = 4,
            
            /** A 6 degrees of freedom joint is applied to the PhysicsBone3D. */
            JOINT_TYPE_6DOF = 5,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicalBone3D extends __NameMapPhysicsBody3D {
    }
    /** A physics body used to make bones in a [Skeleton3D] react to physics.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicalbone3d.html  
     */
    class PhysicalBone3D<Map extends NodePathMap = any> extends PhysicsBody3D<Map> {
        constructor(identifier?: any)
        /** Called during physics processing, allowing you to read and safely modify the simulation state for the object. By default, it is called before the standard force integration, but the [member custom_integrator] property allows you to disable the standard force integration and do fully custom force integration for a body. */
        /* gdvirtual */ _integrate_forces(state: PhysicsDirectBodyState3D): void
        
        /** Applies a directional impulse without affecting rotation.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_integrate_forces" functions otherwise).  
         *  This is equivalent to using [method apply_impulse] at the body's center of mass.  
         */
        apply_central_impulse(impulse: Vector3): void
        
        /** Applies a positioned impulse to the PhysicsBone3D.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_integrate_forces" functions otherwise).  
         *  [param position] is the offset from the PhysicsBone3D origin in global coordinates.  
         */
        apply_impulse(impulse: Vector3, position?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Returns `true` if the PhysicsBone3D is allowed to simulate physics. */
        get_simulate_physics(): boolean
        
        /** Returns `true` if the PhysicsBone3D is currently simulating physics. */
        is_simulating_physics(): boolean
        
        /** Returns the unique identifier of the PhysicsBone3D. */
        get_bone_id(): int64
        
        /** Sets the joint type. */
        get joint_type(): int64
        set joint_type(value: int64)
        
        /** Sets the joint's transform. */
        get joint_offset(): Transform3D
        set joint_offset(value: Transform3D)
        
        /** Sets the joint's rotation in radians. */
        get joint_rotation(): Vector3
        set joint_rotation(value: Vector3)
        
        /** Sets the body's transform. */
        get body_offset(): Transform3D
        set body_offset(value: Transform3D)
        
        /** The body's mass. */
        get mass(): float64
        set mass(value: float64)
        
        /** The body's friction, from `0` (frictionless) to `1` (max friction). */
        get friction(): float64
        set friction(value: float64)
        
        /** The body's bounciness. Values range from `0` (no bounce) to `1` (full bounciness).  
         *      
         *  **Note:** Even with [member bounce] set to `1.0`, some energy will be lost over time due to linear and angular damping. To have a [PhysicalBone3D] that preserves all its energy over time, set [member bounce] to `1.0`, [member linear_damp_mode] to [constant DAMP_MODE_REPLACE], [member linear_damp] to `0.0`, [member angular_damp_mode] to [constant DAMP_MODE_REPLACE], and [member angular_damp] to `0.0`.  
         */
        get bounce(): float64
        set bounce(value: float64)
        
        /** This is multiplied by [member ProjectSettings.physics/3d/default_gravity] to produce this body's gravity. For example, a value of `1.0` will apply normal gravity, `2.0` will apply double the gravity, and `0.5` will apply half the gravity to this body. */
        get gravity_scale(): float64
        set gravity_scale(value: float64)
        
        /** If `true`, the standard force integration (like gravity or damping) will be disabled for this body. Other than collision response, the body will only move as determined by the [method _integrate_forces] method, if that virtual method is overridden.  
         *  Setting this property will call the method [method PhysicsServer3D.body_set_omit_force_integration] internally.  
         */
        get custom_integrator(): boolean
        set custom_integrator(value: boolean)
        
        /** Defines how [member linear_damp] is applied. */
        get linear_damp_mode(): int64
        set linear_damp_mode(value: int64)
        
        /** Damps the body's movement. By default, the body will use [member ProjectSettings.physics/3d/default_linear_damp] or any value override set by an [Area3D] the body is in. Depending on [member linear_damp_mode], [member linear_damp] may be added to or replace the body's damping value.  
         *  See [member ProjectSettings.physics/3d/default_linear_damp] for more details about damping.  
         */
        get linear_damp(): float64
        set linear_damp(value: float64)
        
        /** Defines how [member angular_damp] is applied. */
        get angular_damp_mode(): int64
        set angular_damp_mode(value: int64)
        
        /** Damps the body's rotation. By default, the body will use the [member ProjectSettings.physics/3d/default_angular_damp] project setting or any value override set by an [Area3D] the body is in. Depending on [member angular_damp_mode], you can set [member angular_damp] to be added to or to replace the body's damping value.  
         *  See [member ProjectSettings.physics/3d/default_angular_damp] for more details about damping.  
         */
        get angular_damp(): float64
        set angular_damp(value: float64)
        
        /** The body's linear velocity in units per second. Can be used sporadically, but **don't set this every frame**, because physics may run in another thread and runs at a different granularity. Use [method _integrate_forces] as your process loop for precise control of the body state. */
        get linear_velocity(): Vector3
        set linear_velocity(value: Vector3)
        
        /** The PhysicalBone3D's rotational velocity in  *radians*  per second. */
        get angular_velocity(): Vector3
        set angular_velocity(value: Vector3)
        
        /** If `true`, the body is deactivated when there is no movement, so it will not take part in the simulation until it is awakened by an external force. */
        get can_sleep(): boolean
        set can_sleep(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicalBone3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicalBoneSimulator3D extends __NameMapSkeletonModifier3D {
    }
    /** Node that can be the parent of [PhysicalBone3D] and can apply the simulation results to [Skeleton3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicalbonesimulator3d.html  
     */
    class PhysicalBoneSimulator3D<Map extends NodePathMap = any> extends SkeletonModifier3D<Map> {
        constructor(identifier?: any)
        /** Returns a boolean that indicates whether the [PhysicalBoneSimulator3D] is running and simulating. */
        is_simulating_physics(): boolean
        
        /** Tells the [PhysicalBone3D] nodes in the Skeleton to stop simulating. */
        physical_bones_stop_simulation(): void
        
        /** Tells the [PhysicalBone3D] nodes in the Skeleton to start simulating and reacting to the physics world.  
         *  Optionally, a list of bone names can be passed-in, allowing only the passed-in bones to be simulated.  
         */
        physical_bones_start_simulation(bones?: GArray<StringName>): void
        
        /** Adds a collision exception to the physical bone.  
         *  Works just like the [RigidBody3D] node.  
         */
        physical_bones_add_collision_exception(exception: RID): void
        
        /** Removes a collision exception to the physical bone.  
         *  Works just like the [RigidBody3D] node.  
         */
        physical_bones_remove_collision_exception(exception: RID): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicalBoneSimulator3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicalSkyMaterial extends __NameMapMaterial {
    }
    /** A material that defines a sky for a [Sky] resource by a set of physical properties.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicalskymaterial.html  
     */
    class PhysicalSkyMaterial extends Material {
        constructor(identifier?: any)
        /** Controls the strength of the [url=https://en.wikipedia.org/wiki/Rayleigh_scattering]Rayleigh scattering[/url]. Rayleigh scattering results from light colliding with small particles. It is responsible for the blue color of the sky. */
        get rayleigh_coefficient(): float64
        set rayleigh_coefficient(value: float64)
        
        /** Controls the [Color] of the [url=https://en.wikipedia.org/wiki/Rayleigh_scattering]Rayleigh scattering[/url]. While not physically accurate, this allows for the creation of alien-looking planets. For example, setting this to a red [Color] results in a Mars-looking atmosphere with a corresponding blue sunset. */
        get rayleigh_color(): Color
        set rayleigh_color(value: Color)
        
        /** Controls the strength of [url=https://en.wikipedia.org/wiki/Mie_scattering]Mie scattering[/url] for the sky. Mie scattering results from light colliding with larger particles (like water). On earth, Mie scattering results in a whitish color around the sun and horizon. */
        get mie_coefficient(): float64
        set mie_coefficient(value: float64)
        
        /** Controls the direction of the [url=https://en.wikipedia.org/wiki/Mie_scattering]Mie scattering[/url]. A value of `1` means that when light hits a particle it's passing through straight forward. A value of `-1` means that all light is scatter backwards. */
        get mie_eccentricity(): float64
        set mie_eccentricity(value: float64)
        
        /** Controls the [Color] of the [url=https://en.wikipedia.org/wiki/Mie_scattering]Mie scattering[/url] effect. While not physically accurate, this allows for the creation of alien-looking planets. */
        get mie_color(): Color
        set mie_color(value: Color)
        
        /** Sets the thickness of the atmosphere. High turbidity creates a foggy-looking atmosphere, while a low turbidity results in a clearer atmosphere. */
        get turbidity(): float64
        set turbidity(value: float64)
        
        /** Sets the size of the sun disk. Default value is based on Sol's perceived size from Earth. */
        get sun_disk_scale(): float64
        set sun_disk_scale(value: float64)
        
        /** Modulates the [Color] on the bottom half of the sky to represent the ground. */
        get ground_color(): Color
        set ground_color(value: Color)
        
        /** The sky's overall brightness multiplier. Higher values result in a brighter sky. */
        get energy_multiplier(): float64
        set energy_multiplier(value: float64)
        
        /** If `true`, enables debanding. Debanding adds a small amount of noise which helps reduce banding that appears from the smooth changes in color in the sky. */
        get use_debanding(): boolean
        set use_debanding(value: boolean)
        
        /** [Texture2D] for the night sky. This is added to the sky, so if it is bright enough, it may be visible during the day. */
        get night_sky(): null | Texture2D
        set night_sky(value: null | Texture2D)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicalSkyMaterial;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsBody2D extends __NameMapCollisionObject2D {
    }
    /** Abstract base class for 2D game objects affected by physics.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsbody2d.html  
     */
    class PhysicsBody2D<Map extends NodePathMap = any> extends CollisionObject2D<Map> {
        constructor(identifier?: any)
        /** Moves the body along the vector [param motion]. In order to be frame rate independent in [method Node._physics_process] or [method Node._process], [param motion] should be computed using `delta`.  
         *  Returns a [KinematicCollision2D], which contains information about the collision when stopped, or when touching another body along the motion.  
         *  If [param test_only] is `true`, the body does not move but the would-be collision information is given.  
         *  [param safe_margin] is the extra margin used for collision recovery (see [member CharacterBody2D.safe_margin] for more details).  
         *  If [param recovery_as_collision] is `true`, any depenetration from the recovery phase is also reported as a collision; this is used e.g. by [CharacterBody2D] for improving floor detection during floor snapping.  
         */
        move_and_collide(motion: Vector2, test_only?: boolean /* = false */, safe_margin?: float64 /* = 0.08 */, recovery_as_collision?: boolean /* = false */): null | KinematicCollision2D
        
        /** Checks for collisions without moving the body. In order to be frame rate independent in [method Node._physics_process] or [method Node._process], [param motion] should be computed using `delta`.  
         *  Virtually sets the node's position, scale and rotation to that of the given [Transform2D], then tries to move the body along the vector [param motion]. Returns `true` if a collision would stop the body from moving along the whole path.  
         *  [param collision] is an optional object of type [KinematicCollision2D], which contains additional information about the collision when stopped, or when touching another body along the motion.  
         *  [param safe_margin] is the extra margin used for collision recovery (see [member CharacterBody2D.safe_margin] for more details).  
         *  If [param recovery_as_collision] is `true`, any depenetration from the recovery phase is also reported as a collision; this is useful for checking whether the body would  *touch*  any other bodies.  
         */
        test_move(from: Transform2D, motion: Vector2, collision?: KinematicCollision2D, safe_margin?: float64 /* = 0.08 */, recovery_as_collision?: boolean /* = false */): boolean
        
        /** Returns the gravity vector computed from all sources that can affect the body, including all gravity overrides from [Area2D] nodes and the global world gravity. */
        get_gravity(): Vector2
        
        /** Returns an array of nodes that were added as collision exceptions for this body. */
        get_collision_exceptions(): GArray<PhysicsBody2D>
        
        /** Adds a body to the list of bodies that this body can't collide with. */
        add_collision_exception_with(body: Node): void
        
        /** Removes a body from the list of bodies that this body can't collide with. */
        remove_collision_exception_with(body: Node): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsBody2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsBody3D extends __NameMapCollisionObject3D {
    }
    /** Abstract base class for 3D game objects affected by physics.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsbody3d.html  
     */
    class PhysicsBody3D<Map extends NodePathMap = any> extends CollisionObject3D<Map> {
        constructor(identifier?: any)
        /** Moves the body along the vector [param motion]. In order to be frame rate independent in [method Node._physics_process] or [method Node._process], [param motion] should be computed using `delta`.  
         *  The body will stop if it collides. Returns a [KinematicCollision3D], which contains information about the collision when stopped, or when touching another body along the motion.  
         *  If [param test_only] is `true`, the body does not move but the would-be collision information is given.  
         *  [param safe_margin] is the extra margin used for collision recovery (see [member CharacterBody3D.safe_margin] for more details).  
         *  If [param recovery_as_collision] is `true`, any depenetration from the recovery phase is also reported as a collision; this is used e.g. by [CharacterBody3D] for improving floor detection during floor snapping.  
         *  [param max_collisions] allows to retrieve more than one collision result.  
         */
        move_and_collide(motion: Vector3, test_only?: boolean /* = false */, safe_margin?: float64 /* = 0.001 */, recovery_as_collision?: boolean /* = false */, max_collisions?: int64 /* = 1 */): null | KinematicCollision3D
        
        /** Checks for collisions without moving the body. In order to be frame rate independent in [method Node._physics_process] or [method Node._process], [param motion] should be computed using `delta`.  
         *  Virtually sets the node's position, scale and rotation to that of the given [Transform3D], then tries to move the body along the vector [param motion]. Returns `true` if a collision would stop the body from moving along the whole path.  
         *  [param collision] is an optional object of type [KinematicCollision3D], which contains additional information about the collision when stopped, or when touching another body along the motion.  
         *  [param safe_margin] is the extra margin used for collision recovery (see [member CharacterBody3D.safe_margin] for more details).  
         *  If [param recovery_as_collision] is `true`, any depenetration from the recovery phase is also reported as a collision; this is useful for checking whether the body would  *touch*  any other bodies.  
         *  [param max_collisions] allows to retrieve more than one collision result.  
         */
        test_move(from: Transform3D, motion: Vector3, collision?: KinematicCollision3D, safe_margin?: float64 /* = 0.001 */, recovery_as_collision?: boolean /* = false */, max_collisions?: int64 /* = 1 */): boolean
        
        /** Returns the gravity vector computed from all sources that can affect the body, including all gravity overrides from [Area3D] nodes and the global world gravity. */
        get_gravity(): Vector3
        
        /** Locks or unlocks the specified linear or rotational [param axis] depending on the value of [param lock]. */
        set_axis_lock(axis: PhysicsServer3D.BodyAxis, lock: boolean): void
        
        /** Returns `true` if the specified linear or rotational [param axis] is locked. */
        get_axis_lock(axis: PhysicsServer3D.BodyAxis): boolean
        
        /** Returns an array of nodes that were added as collision exceptions for this body. */
        get_collision_exceptions(): GArray<PhysicsBody3D>
        
        /** Adds a body to the list of bodies that this body can't collide with. */
        add_collision_exception_with(body: Node): void
        
        /** Removes a body from the list of bodies that this body can't collide with. */
        remove_collision_exception_with(body: Node): void
        
        /** Lock the body's linear movement in the X axis. */
        get axis_lock_linear_x(): boolean
        set axis_lock_linear_x(value: boolean)
        
        /** Lock the body's linear movement in the Y axis. */
        get axis_lock_linear_y(): boolean
        set axis_lock_linear_y(value: boolean)
        
        /** Lock the body's linear movement in the Z axis. */
        get axis_lock_linear_z(): boolean
        set axis_lock_linear_z(value: boolean)
        
        /** Lock the body's rotation in the X axis. */
        get axis_lock_angular_x(): boolean
        set axis_lock_angular_x(value: boolean)
        
        /** Lock the body's rotation in the Y axis. */
        get axis_lock_angular_y(): boolean
        set axis_lock_angular_y(value: boolean)
        
        /** Lock the body's rotation in the Z axis. */
        get axis_lock_angular_z(): boolean
        set axis_lock_angular_z(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsBody3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectBodyState2D extends __NameMapObject {
    }
    /** Provides direct access to a physics body in the [PhysicsServer2D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectbodystate2d.html  
     */
    class PhysicsDirectBodyState2D extends Object {
        constructor(identifier?: any)
        /** Returns the body's velocity at the given relative position, including both translation and rotation. */
        get_velocity_at_local_position(local_position: Vector2): Vector2
        
        /** Applies a directional impulse without affecting rotation.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         *  This is equivalent to using [method apply_impulse] at the body's center of mass.  
         */
        apply_central_impulse(impulse: Vector2): void
        
        /** Applies a rotational impulse to the body without affecting the position.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         *      
         *  **Note:** [member inverse_inertia] is required for this to work. To have [member inverse_inertia], an active [CollisionShape2D] must be a child of the node, or you can manually set [member inverse_inertia].  
         */
        apply_torque_impulse(impulse: float64): void
        
        /** Applies a positioned impulse to the body.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         *  [param position] is the offset from the body origin in global coordinates.  
         */
        apply_impulse(impulse: Vector2, position?: Vector2 /* = Vector2.ZERO */): void
        
        /** Applies a directional force without affecting rotation. A force is time dependent and meant to be applied every physics update.  
         *  This is equivalent to using [method apply_force] at the body's center of mass.  
         */
        apply_central_force(force?: Vector2 /* = Vector2.ZERO */): void
        
        /** Applies a positioned force to the body. A force is time dependent and meant to be applied every physics update.  
         *  [param position] is the offset from the body origin in global coordinates.  
         */
        apply_force(force: Vector2, position?: Vector2 /* = Vector2.ZERO */): void
        
        /** Applies a rotational force without affecting position. A force is time dependent and meant to be applied every physics update.  
         *      
         *  **Note:** [member inverse_inertia] is required for this to work. To have [member inverse_inertia], an active [CollisionShape2D] must be a child of the node, or you can manually set [member inverse_inertia].  
         */
        apply_torque(torque: float64): void
        
        /** Adds a constant directional force without affecting rotation that keeps being applied over time until cleared with `constant_force = Vector2(0, 0)`.  
         *  This is equivalent to using [method add_constant_force] at the body's center of mass.  
         */
        add_constant_central_force(force?: Vector2 /* = Vector2.ZERO */): void
        
        /** Adds a constant positioned force to the body that keeps being applied over time until cleared with `constant_force = Vector2(0, 0)`.  
         *  [param position] is the offset from the body origin in global coordinates.  
         */
        add_constant_force(force: Vector2, position?: Vector2 /* = Vector2.ZERO */): void
        
        /** Adds a constant rotational force without affecting position that keeps being applied over time until cleared with `constant_torque = 0`. */
        add_constant_torque(torque: float64): void
        
        /** Sets the body's total constant positional forces applied during each physics update.  
         *  See [method add_constant_force] and [method add_constant_central_force].  
         */
        set_constant_force(force: Vector2): void
        
        /** Returns the body's total constant positional forces applied during each physics update.  
         *  See [method add_constant_force] and [method add_constant_central_force].  
         */
        get_constant_force(): Vector2
        
        /** Sets the body's total constant rotational forces applied during each physics update.  
         *  See [method add_constant_torque].  
         */
        set_constant_torque(torque: float64): void
        
        /** Returns the body's total constant rotational forces applied during each physics update.  
         *  See [method add_constant_torque].  
         */
        get_constant_torque(): float64
        
        /** Returns the number of contacts this body has with other bodies.  
         *      
         *  **Note:** By default, this returns 0 unless bodies are configured to monitor contacts. See [member RigidBody2D.contact_monitor].  
         */
        get_contact_count(): int64
        
        /** Returns the position of the contact point on the body in the global coordinate system. */
        get_contact_local_position(contact_idx: int64): Vector2
        
        /** Returns the local normal at the contact point. */
        get_contact_local_normal(contact_idx: int64): Vector2
        
        /** Returns the local shape index of the collision. */
        get_contact_local_shape(contact_idx: int64): int64
        
        /** Returns the velocity vector at the body's contact point. */
        get_contact_local_velocity_at_position(contact_idx: int64): Vector2
        
        /** Returns the collider's [RID]. */
        get_contact_collider(contact_idx: int64): RID
        
        /** Returns the position of the contact point on the collider in the global coordinate system. */
        get_contact_collider_position(contact_idx: int64): Vector2
        
        /** Returns the collider's object id. */
        get_contact_collider_id(contact_idx: int64): int64
        
        /** Returns the collider object. This depends on how it was created (will return a scene node if such was used to create it). */
        get_contact_collider_object(contact_idx: int64): null | Object
        
        /** Returns the collider's shape index. */
        get_contact_collider_shape(contact_idx: int64): int64
        
        /** Returns the velocity vector at the collider's contact point. */
        get_contact_collider_velocity_at_position(contact_idx: int64): Vector2
        
        /** Returns the impulse created by the contact. */
        get_contact_impulse(contact_idx: int64): Vector2
        
        /** Updates the body's linear and angular velocity by applying gravity and damping for the equivalent of one physics tick. */
        integrate_forces(): void
        
        /** Returns the current state of the space, useful for queries. */
        get_space_state(): null | PhysicsDirectSpaceState2D
        
        /** The timestep (delta) used for the simulation. */
        get step(): float64
        
        /** The inverse of the mass of the body. */
        get inverse_mass(): float64
        
        /** The inverse of the inertia of the body. */
        get inverse_inertia(): float64
        
        /** The rate at which the body stops rotating, if there are not any other forces moving it. */
        get total_angular_damp(): float64
        
        /** The rate at which the body stops moving, if there are not any other forces moving it. */
        get total_linear_damp(): float64
        
        /** The total gravity vector being currently applied to this body. */
        get total_gravity(): Vector2
        
        /** The body's center of mass position relative to the body's center in the global coordinate system. */
        get center_of_mass(): Vector2
        
        /** The body's center of mass position in the body's local coordinate system. */
        get center_of_mass_local(): Vector2
        
        /** The body's rotational velocity in  *radians*  per second. */
        get angular_velocity(): float64
        set angular_velocity(value: float64)
        
        /** The body's linear velocity in pixels per second. */
        get linear_velocity(): Vector2
        set linear_velocity(value: Vector2)
        
        /** If `true`, this body is currently sleeping (not active). */
        get sleeping(): boolean
        set sleeping(value: boolean)
        
        /** The body's collision layer. */
        get collision_layer(): int64
        set collision_layer(value: int64)
        
        /** The body's collision mask. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The body's transformation matrix. */
        get transform(): Transform2D
        set transform(value: Transform2D)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectBodyState2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectBodyState2DExtension extends __NameMapPhysicsDirectBodyState2D {
    }
    /** Provides virtual methods that can be overridden to create custom [PhysicsDirectBodyState2D] implementations.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectbodystate2dextension.html  
     */
    class PhysicsDirectBodyState2DExtension extends PhysicsDirectBodyState2D {
        constructor(identifier?: any)
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.total_gravity] and its respective getter. */
        /* gdvirtual */ _get_total_gravity(): Vector2
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.total_linear_damp] and its respective getter. */
        /* gdvirtual */ _get_total_linear_damp(): float64
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.total_angular_damp] and its respective getter. */
        /* gdvirtual */ _get_total_angular_damp(): float64
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.center_of_mass] and its respective getter. */
        /* gdvirtual */ _get_center_of_mass(): Vector2
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.center_of_mass_local] and its respective getter. */
        /* gdvirtual */ _get_center_of_mass_local(): Vector2
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.inverse_mass] and its respective getter. */
        /* gdvirtual */ _get_inverse_mass(): float64
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.inverse_inertia] and its respective getter. */
        /* gdvirtual */ _get_inverse_inertia(): float64
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.linear_velocity] and its respective setter. */
        /* gdvirtual */ _set_linear_velocity(velocity: Vector2): void
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.linear_velocity] and its respective getter. */
        /* gdvirtual */ _get_linear_velocity(): Vector2
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.angular_velocity] and its respective setter. */
        /* gdvirtual */ _set_angular_velocity(velocity: float64): void
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.angular_velocity] and its respective getter. */
        /* gdvirtual */ _get_angular_velocity(): float64
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.transform] and its respective setter. */
        /* gdvirtual */ _set_transform(transform: Transform2D): void
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.transform] and its respective getter. */
        /* gdvirtual */ _get_transform(): Transform2D
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_velocity_at_local_position]. */
        /* gdvirtual */ _get_velocity_at_local_position(local_position: Vector2): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.apply_central_impulse]. */
        /* gdvirtual */ _apply_central_impulse(impulse: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.apply_impulse]. */
        /* gdvirtual */ _apply_impulse(impulse: Vector2, position: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.apply_torque_impulse]. */
        /* gdvirtual */ _apply_torque_impulse(impulse: float64): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.apply_central_force]. */
        /* gdvirtual */ _apply_central_force(force: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.apply_force]. */
        /* gdvirtual */ _apply_force(force: Vector2, position: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.apply_torque]. */
        /* gdvirtual */ _apply_torque(torque: float64): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.add_constant_central_force]. */
        /* gdvirtual */ _add_constant_central_force(force: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.add_constant_force]. */
        /* gdvirtual */ _add_constant_force(force: Vector2, position: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.add_constant_torque]. */
        /* gdvirtual */ _add_constant_torque(torque: float64): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.set_constant_force]. */
        /* gdvirtual */ _set_constant_force(force: Vector2): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_constant_force]. */
        /* gdvirtual */ _get_constant_force(): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.set_constant_torque]. */
        /* gdvirtual */ _set_constant_torque(torque: float64): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_constant_torque]. */
        /* gdvirtual */ _get_constant_torque(): float64
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.sleeping] and its respective setter. */
        /* gdvirtual */ _set_sleep_state(enabled: boolean): void
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.sleeping] and its respective getter. */
        /* gdvirtual */ _is_sleeping(): boolean
        /* gdvirtual */ _set_collision_layer(layer: int64): void
        /* gdvirtual */ _get_collision_layer(): int64
        /* gdvirtual */ _set_collision_mask(mask: int64): void
        /* gdvirtual */ _get_collision_mask(): int64
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_count]. */
        /* gdvirtual */ _get_contact_count(): int64
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_local_position]. */
        /* gdvirtual */ _get_contact_local_position(contact_idx: int64): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_local_normal]. */
        /* gdvirtual */ _get_contact_local_normal(contact_idx: int64): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_local_shape]. */
        /* gdvirtual */ _get_contact_local_shape(contact_idx: int64): int64
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_local_velocity_at_position]. */
        /* gdvirtual */ _get_contact_local_velocity_at_position(contact_idx: int64): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_collider]. */
        /* gdvirtual */ _get_contact_collider(contact_idx: int64): RID
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_collider_position]. */
        /* gdvirtual */ _get_contact_collider_position(contact_idx: int64): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_collider_id]. */
        /* gdvirtual */ _get_contact_collider_id(contact_idx: int64): int64
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_collider_object]. */
        /* gdvirtual */ _get_contact_collider_object(contact_idx: int64): null | Object
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_collider_shape]. */
        /* gdvirtual */ _get_contact_collider_shape(contact_idx: int64): int64
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_collider_velocity_at_position]. */
        /* gdvirtual */ _get_contact_collider_velocity_at_position(contact_idx: int64): Vector2
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_contact_impulse]. */
        /* gdvirtual */ _get_contact_impulse(contact_idx: int64): Vector2
        
        /** Implement to override the behavior of [member PhysicsDirectBodyState2D.step] and its respective getter. */
        /* gdvirtual */ _get_step(): float64
        
        /** Overridable version of [method PhysicsDirectBodyState2D.integrate_forces]. */
        /* gdvirtual */ _integrate_forces(): void
        
        /** Overridable version of [method PhysicsDirectBodyState2D.get_space_state]. */
        /* gdvirtual */ _get_space_state(): null | PhysicsDirectSpaceState2D
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectBodyState2DExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectBodyState3D extends __NameMapObject {
    }
    /** Provides direct access to a physics body in the [PhysicsServer3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectbodystate3d.html  
     */
    class PhysicsDirectBodyState3D extends Object {
        constructor(identifier?: any)
        /** Returns the body's velocity at the given relative position, including both translation and rotation. */
        get_velocity_at_local_position(local_position: Vector3): Vector3
        
        /** Applies a directional impulse without affecting rotation.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         *  This is equivalent to using [method apply_impulse] at the body's center of mass.  
         */
        apply_central_impulse(impulse?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Applies a positioned impulse to the body.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         *  [param position] is the offset from the body origin in global coordinates.  
         */
        apply_impulse(impulse: Vector3, position?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Applies a rotational impulse to the body without affecting the position.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         *      
         *  **Note:** [member inverse_inertia] is required for this to work. To have [member inverse_inertia], an active [CollisionShape3D] must be a child of the node, or you can manually set [member inverse_inertia].  
         */
        apply_torque_impulse(impulse: Vector3): void
        
        /** Applies a directional force without affecting rotation. A force is time dependent and meant to be applied every physics update.  
         *  This is equivalent to using [method apply_force] at the body's center of mass.  
         */
        apply_central_force(force?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Applies a positioned force to the body. A force is time dependent and meant to be applied every physics update.  
         *  [param position] is the offset from the body origin in global coordinates.  
         */
        apply_force(force: Vector3, position?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Applies a rotational force without affecting position. A force is time dependent and meant to be applied every physics update.  
         *      
         *  **Note:** [member inverse_inertia] is required for this to work. To have [member inverse_inertia], an active [CollisionShape3D] must be a child of the node, or you can manually set [member inverse_inertia].  
         */
        apply_torque(torque: Vector3): void
        
        /** Adds a constant directional force without affecting rotation that keeps being applied over time until cleared with `constant_force = Vector3(0, 0, 0)`.  
         *  This is equivalent to using [method add_constant_force] at the body's center of mass.  
         */
        add_constant_central_force(force?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Adds a constant positioned force to the body that keeps being applied over time until cleared with `constant_force = Vector3(0, 0, 0)`.  
         *  [param position] is the offset from the body origin in global coordinates.  
         */
        add_constant_force(force: Vector3, position?: Vector3 /* = new Vector3(0, 0, 0) */): void
        
        /** Adds a constant rotational force without affecting position that keeps being applied over time until cleared with `constant_torque = Vector3(0, 0, 0)`. */
        add_constant_torque(torque: Vector3): void
        
        /** Sets the body's total constant positional forces applied during each physics update.  
         *  See [method add_constant_force] and [method add_constant_central_force].  
         */
        set_constant_force(force: Vector3): void
        
        /** Returns the body's total constant positional forces applied during each physics update.  
         *  See [method add_constant_force] and [method add_constant_central_force].  
         */
        get_constant_force(): Vector3
        
        /** Sets the body's total constant rotational forces applied during each physics update.  
         *  See [method add_constant_torque].  
         */
        set_constant_torque(torque: Vector3): void
        
        /** Returns the body's total constant rotational forces applied during each physics update.  
         *  See [method add_constant_torque].  
         */
        get_constant_torque(): Vector3
        
        /** Returns the number of contacts this body has with other bodies.  
         *      
         *  **Note:** By default, this returns 0 unless bodies are configured to monitor contacts. See [member RigidBody3D.contact_monitor].  
         */
        get_contact_count(): int64
        
        /** Returns the position of the contact point on the body in the global coordinate system. */
        get_contact_local_position(contact_idx: int64): Vector3
        
        /** Returns the local normal at the contact point. */
        get_contact_local_normal(contact_idx: int64): Vector3
        
        /** Impulse created by the contact. */
        get_contact_impulse(contact_idx: int64): Vector3
        
        /** Returns the local shape index of the collision. */
        get_contact_local_shape(contact_idx: int64): int64
        
        /** Returns the linear velocity vector at the body's contact point. */
        get_contact_local_velocity_at_position(contact_idx: int64): Vector3
        
        /** Returns the collider's [RID]. */
        get_contact_collider(contact_idx: int64): RID
        
        /** Returns the position of the contact point on the collider in the global coordinate system. */
        get_contact_collider_position(contact_idx: int64): Vector3
        
        /** Returns the collider's object id. */
        get_contact_collider_id(contact_idx: int64): int64
        
        /** Returns the collider object. */
        get_contact_collider_object(contact_idx: int64): null | Object
        
        /** Returns the collider's shape index. */
        get_contact_collider_shape(contact_idx: int64): int64
        
        /** Returns the linear velocity vector at the collider's contact point. */
        get_contact_collider_velocity_at_position(contact_idx: int64): Vector3
        
        /** Updates the body's linear and angular velocity by applying gravity and damping for the equivalent of one physics tick. */
        integrate_forces(): void
        
        /** Returns the current state of the space, useful for queries. */
        get_space_state(): null | PhysicsDirectSpaceState3D
        
        /** The timestep (delta) used for the simulation. */
        get step(): float64
        
        /** The inverse of the mass of the body. */
        get inverse_mass(): float64
        
        /** The rate at which the body stops rotating, if there are not any other forces moving it. */
        get total_angular_damp(): float64
        
        /** The rate at which the body stops moving, if there are not any other forces moving it. */
        get total_linear_damp(): float64
        
        /** The inverse of the inertia of the body. */
        get inverse_inertia(): Vector3
        
        /** The inverse of the inertia tensor of the body. */
        get inverse_inertia_tensor(): Basis
        
        /** The total gravity vector being currently applied to this body. */
        get total_gravity(): Vector3
        
        /** The body's center of mass position relative to the body's center in the global coordinate system. */
        get center_of_mass(): Vector3
        
        /** The body's center of mass position in the body's local coordinate system. */
        get center_of_mass_local(): Vector3
        get principal_inertia_axes(): Basis
        
        /** The body's rotational velocity in  *radians*  per second. */
        get angular_velocity(): Vector3
        set angular_velocity(value: Vector3)
        
        /** The body's linear velocity in units per second. */
        get linear_velocity(): Vector3
        set linear_velocity(value: Vector3)
        
        /** If `true`, this body is currently sleeping (not active). */
        get sleeping(): boolean
        set sleeping(value: boolean)
        
        /** The body's collision layer. */
        get collision_layer(): int64
        set collision_layer(value: int64)
        
        /** The body's collision mask. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The body's transformation matrix. */
        get transform(): Transform3D
        set transform(value: Transform3D)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectBodyState3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectBodyState3DExtension extends __NameMapPhysicsDirectBodyState3D {
    }
    /** Provides virtual methods that can be overridden to create custom [PhysicsDirectBodyState3D] implementations.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectbodystate3dextension.html  
     */
    class PhysicsDirectBodyState3DExtension extends PhysicsDirectBodyState3D {
        constructor(identifier?: any)
        /* gdvirtual */ _get_total_gravity(): Vector3
        /* gdvirtual */ _get_total_linear_damp(): float64
        /* gdvirtual */ _get_total_angular_damp(): float64
        /* gdvirtual */ _get_center_of_mass(): Vector3
        /* gdvirtual */ _get_center_of_mass_local(): Vector3
        /* gdvirtual */ _get_principal_inertia_axes(): Basis
        /* gdvirtual */ _get_inverse_mass(): float64
        /* gdvirtual */ _get_inverse_inertia(): Vector3
        /* gdvirtual */ _get_inverse_inertia_tensor(): Basis
        /* gdvirtual */ _set_linear_velocity(velocity: Vector3): void
        /* gdvirtual */ _get_linear_velocity(): Vector3
        /* gdvirtual */ _set_angular_velocity(velocity: Vector3): void
        /* gdvirtual */ _get_angular_velocity(): Vector3
        /* gdvirtual */ _set_transform(transform: Transform3D): void
        /* gdvirtual */ _get_transform(): Transform3D
        /* gdvirtual */ _get_velocity_at_local_position(local_position: Vector3): Vector3
        /* gdvirtual */ _apply_central_impulse(impulse: Vector3): void
        /* gdvirtual */ _apply_impulse(impulse: Vector3, position: Vector3): void
        /* gdvirtual */ _apply_torque_impulse(impulse: Vector3): void
        /* gdvirtual */ _apply_central_force(force: Vector3): void
        /* gdvirtual */ _apply_force(force: Vector3, position: Vector3): void
        /* gdvirtual */ _apply_torque(torque: Vector3): void
        /* gdvirtual */ _add_constant_central_force(force: Vector3): void
        /* gdvirtual */ _add_constant_force(force: Vector3, position: Vector3): void
        /* gdvirtual */ _add_constant_torque(torque: Vector3): void
        /* gdvirtual */ _set_constant_force(force: Vector3): void
        /* gdvirtual */ _get_constant_force(): Vector3
        /* gdvirtual */ _set_constant_torque(torque: Vector3): void
        /* gdvirtual */ _get_constant_torque(): Vector3
        /* gdvirtual */ _set_sleep_state(enabled: boolean): void
        /* gdvirtual */ _is_sleeping(): boolean
        /* gdvirtual */ _set_collision_layer(layer: int64): void
        /* gdvirtual */ _get_collision_layer(): int64
        /* gdvirtual */ _set_collision_mask(mask: int64): void
        /* gdvirtual */ _get_collision_mask(): int64
        /* gdvirtual */ _get_contact_count(): int64
        /* gdvirtual */ _get_contact_local_position(contact_idx: int64): Vector3
        /* gdvirtual */ _get_contact_local_normal(contact_idx: int64): Vector3
        /* gdvirtual */ _get_contact_impulse(contact_idx: int64): Vector3
        /* gdvirtual */ _get_contact_local_shape(contact_idx: int64): int64
        /* gdvirtual */ _get_contact_local_velocity_at_position(contact_idx: int64): Vector3
        /* gdvirtual */ _get_contact_collider(contact_idx: int64): RID
        /* gdvirtual */ _get_contact_collider_position(contact_idx: int64): Vector3
        /* gdvirtual */ _get_contact_collider_id(contact_idx: int64): int64
        /* gdvirtual */ _get_contact_collider_object(contact_idx: int64): null | Object
        /* gdvirtual */ _get_contact_collider_shape(contact_idx: int64): int64
        /* gdvirtual */ _get_contact_collider_velocity_at_position(contact_idx: int64): Vector3
        /* gdvirtual */ _get_step(): float64
        /* gdvirtual */ _integrate_forces(): void
        /* gdvirtual */ _get_space_state(): null | PhysicsDirectSpaceState3D
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectBodyState3DExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectSpaceState2D extends __NameMapObject {
    }
    /** Provides direct access to a physics space in the [PhysicsServer2D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectspacestate2d.html  
     */
    class PhysicsDirectSpaceState2D extends Object {
        constructor(identifier?: any)
        /** Checks whether a point is inside any solid shape. Position and other parameters are defined through [PhysicsPointQueryParameters2D]. The shapes the point is inside of are returned in an array containing dictionaries with the following fields:  
         *  `collider`: The colliding object.  
         *  `collider_id`: The colliding object's ID.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  The number of intersections can be limited with the [param max_results] parameter, to reduce the processing time.  
         *      
         *  **Note:** [ConcavePolygonShape2D]s and [CollisionPolygon2D]s in `Segments` build mode are not solid shapes. Therefore, they will not be detected.  
         */
        intersect_point(parameters: PhysicsPointQueryParameters2D, max_results?: int64 /* = 32 */): GArray<GDictionary>
        
        /** Intersects a ray in a given space. Ray position and other parameters are defined through [PhysicsRayQueryParameters2D]. The returned object is a dictionary with the following fields:  
         *  `collider`: The colliding object.  
         *  `collider_id`: The colliding object's ID.  
         *  `normal`: The object's surface normal at the intersection point, or `Vector2(0, 0)` if the ray starts inside the shape and [member PhysicsRayQueryParameters2D.hit_from_inside] is `true`.  
         *  `position`: The intersection point.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  If the ray did not intersect anything, then an empty dictionary is returned instead.  
         */
        intersect_ray(parameters: PhysicsRayQueryParameters2D): GDictionary
        
        /** Checks the intersections of a shape, given through a [PhysicsShapeQueryParameters2D] object, against the space. The intersected shapes are returned in an array containing dictionaries with the following fields:  
         *  `collider`: The colliding object.  
         *  `collider_id`: The colliding object's ID.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  The number of intersections can be limited with the [param max_results] parameter, to reduce the processing time.  
         */
        intersect_shape(parameters: PhysicsShapeQueryParameters2D, max_results?: int64 /* = 32 */): GArray<GDictionary>
        
        /** Checks how far a [Shape2D] can move without colliding. All the parameters for the query, including the shape and the motion, are supplied through a [PhysicsShapeQueryParameters2D] object.  
         *  Returns an array with the safe and unsafe proportions (between 0 and 1) of the motion. The safe proportion is the maximum fraction of the motion that can be made without a collision. The unsafe proportion is the minimum fraction of the distance that must be moved for a collision. If no collision is detected a result of `[1.0, 1.0]` will be returned.  
         *      
         *  **Note:** Any [Shape2D]s that the shape is already colliding with e.g. inside of, will be ignored. Use [method collide_shape] to determine the [Shape2D]s that the shape is already colliding with.  
         */
        cast_motion(parameters: PhysicsShapeQueryParameters2D): PackedFloat32Array
        
        /** Checks the intersections of a shape, given through a [PhysicsShapeQueryParameters2D] object, against the space. The resulting array contains a list of points where the shape intersects another. Like with [method intersect_shape], the number of returned results can be limited to save processing time.  
         *  Returned points are a list of pairs of contact points. For each pair the first one is in the shape passed in [PhysicsShapeQueryParameters2D] object, second one is in the collided shape from the physics space.  
         */
        collide_shape(parameters: PhysicsShapeQueryParameters2D, max_results?: int64 /* = 32 */): GArray<Vector2>
        
        /** Checks the intersections of a shape, given through a [PhysicsShapeQueryParameters2D] object, against the space. If it collides with more than one shape, the nearest one is selected. The returned object is a dictionary containing the following fields:  
         *  `collider_id`: The colliding object's ID.  
         *  `linear_velocity`: The colliding object's velocity [Vector2]. If the object is an [Area2D], the result is `(0, 0)`.  
         *  `normal`: The collision normal of the query shape at the intersection point, pointing away from the intersecting object.  
         *  `point`: The intersection point.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  If the shape did not intersect anything, then an empty dictionary is returned instead.  
         */
        get_rest_info(parameters: PhysicsShapeQueryParameters2D): GDictionary
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectSpaceState2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectSpaceState2DExtension extends __NameMapPhysicsDirectSpaceState2D {
    }
    /** Provides virtual methods that can be overridden to create custom [PhysicsDirectSpaceState2D] implementations.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectspacestate2dextension.html  
     */
    class PhysicsDirectSpaceState2DExtension extends PhysicsDirectSpaceState2D {
        constructor(identifier?: any)
        /* gdvirtual */ _intersect_ray(from: Vector2, to: Vector2, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, hit_from_inside: boolean, result: int64): boolean
        /* gdvirtual */ _intersect_point(position: Vector2, canvas_instance_id: int64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, results: int64, max_results: int64): int64
        /* gdvirtual */ _intersect_shape(shape_rid: RID, transform: Transform2D, motion: Vector2, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, result: int64, max_results: int64): int64
        /* gdvirtual */ _cast_motion(shape_rid: RID, transform: Transform2D, motion: Vector2, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, closest_safe: int64, closest_unsafe: int64): boolean
        /* gdvirtual */ _collide_shape(shape_rid: RID, transform: Transform2D, motion: Vector2, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, results: int64, max_results: int64, result_count: int64): boolean
        /* gdvirtual */ _rest_info(shape_rid: RID, transform: Transform2D, motion: Vector2, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, rest_info: int64): boolean
        is_body_excluded_from_query(body: RID): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectSpaceState2DExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectSpaceState3D extends __NameMapObject {
    }
    /** Provides direct access to a physics space in the [PhysicsServer3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectspacestate3d.html  
     */
    class PhysicsDirectSpaceState3D extends Object {
        constructor(identifier?: any)
        /** Checks whether a point is inside any solid shape. Position and other parameters are defined through [PhysicsPointQueryParameters3D]. The shapes the point is inside of are returned in an array containing dictionaries with the following fields:  
         *  `collider`: The colliding object.  
         *  `collider_id`: The colliding object's ID.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  The number of intersections can be limited with the [param max_results] parameter, to reduce the processing time.  
         */
        intersect_point(parameters: PhysicsPointQueryParameters3D, max_results?: int64 /* = 32 */): GArray<GDictionary>
        
        /** Intersects a ray in a given space. Ray position and other parameters are defined through [PhysicsRayQueryParameters3D]. The returned object is a dictionary with the following fields:  
         *  `collider`: The colliding object.  
         *  `collider_id`: The colliding object's ID.  
         *  `normal`: The object's surface normal at the intersection point, or `Vector3(0, 0, 0)` if the ray starts inside the shape and [member PhysicsRayQueryParameters3D.hit_from_inside] is `true`.  
         *  `position`: The intersection point.  
         *  `face_index`: The face index at the intersection point.  
         *      
         *  **Note:** Returns a valid number only if the intersected shape is a [ConcavePolygonShape3D]. Otherwise, `-1` is returned.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  If the ray did not intersect anything, then an empty dictionary is returned instead.  
         */
        intersect_ray(parameters: PhysicsRayQueryParameters3D): GDictionary
        
        /** Checks the intersections of a shape, given through a [PhysicsShapeQueryParameters3D] object, against the space. The intersected shapes are returned in an array containing dictionaries with the following fields:  
         *  `collider`: The colliding object.  
         *  `collider_id`: The colliding object's ID.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  The number of intersections can be limited with the [param max_results] parameter, to reduce the processing time.  
         *      
         *  **Note:** This method does not take into account the `motion` property of the object.  
         */
        intersect_shape(parameters: PhysicsShapeQueryParameters3D, max_results?: int64 /* = 32 */): GArray<GDictionary>
        
        /** Checks how far a [Shape3D] can move without colliding. All the parameters for the query, including the shape and the motion, are supplied through a [PhysicsShapeQueryParameters3D] object.  
         *  Returns an array with the safe and unsafe proportions (between 0 and 1) of the motion. The safe proportion is the maximum fraction of the motion that can be made without a collision. The unsafe proportion is the minimum fraction of the distance that must be moved for a collision. If no collision is detected a result of `[1.0, 1.0]` will be returned.  
         *      
         *  **Note:** Any [Shape3D]s that the shape is already colliding with e.g. inside of, will be ignored. Use [method collide_shape] to determine the [Shape3D]s that the shape is already colliding with.  
         */
        cast_motion(parameters: PhysicsShapeQueryParameters3D): PackedFloat32Array
        
        /** Checks the intersections of a shape, given through a [PhysicsShapeQueryParameters3D] object, against the space. The resulting array contains a list of points where the shape intersects another. Like with [method intersect_shape], the number of returned results can be limited to save processing time.  
         *  Returned points are a list of pairs of contact points. For each pair the first one is in the shape passed in [PhysicsShapeQueryParameters3D] object, second one is in the collided shape from the physics space.  
         *      
         *  **Note:** This method does not take into account the `motion` property of the object.  
         */
        collide_shape(parameters: PhysicsShapeQueryParameters3D, max_results?: int64 /* = 32 */): GArray<Vector3>
        
        /** Checks the intersections of a shape, given through a [PhysicsShapeQueryParameters3D] object, against the space. If it collides with more than one shape, the nearest one is selected. The returned object is a dictionary containing the following fields:  
         *  `collider_id`: The colliding object's ID.  
         *  `linear_velocity`: The colliding object's velocity [Vector3]. If the object is an [Area3D], the result is `(0, 0, 0)`.  
         *  `normal`: The collision normal of the query shape at the intersection point, pointing away from the intersecting object.  
         *  `point`: The intersection point.  
         *  `rid`: The intersecting object's [RID].  
         *  `shape`: The shape index of the colliding shape.  
         *  If the shape did not intersect anything, then an empty dictionary is returned instead.  
         *      
         *  **Note:** This method does not take into account the `motion` property of the object.  
         */
        get_rest_info(parameters: PhysicsShapeQueryParameters3D): GDictionary
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectSpaceState3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsDirectSpaceState3DExtension extends __NameMapPhysicsDirectSpaceState3D {
    }
    /** Provides virtual methods that can be overridden to create custom [PhysicsDirectSpaceState3D] implementations.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsdirectspacestate3dextension.html  
     */
    class PhysicsDirectSpaceState3DExtension extends PhysicsDirectSpaceState3D {
        constructor(identifier?: any)
        /* gdvirtual */ _intersect_ray(from: Vector3, to: Vector3, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, hit_from_inside: boolean, hit_back_faces: boolean, pick_ray: boolean, result: int64): boolean
        /* gdvirtual */ _intersect_point(position: Vector3, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, results: int64, max_results: int64): int64
        /* gdvirtual */ _intersect_shape(shape_rid: RID, transform: Transform3D, motion: Vector3, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, result_count: int64, max_results: int64): int64
        /* gdvirtual */ _cast_motion(shape_rid: RID, transform: Transform3D, motion: Vector3, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, closest_safe: int64, closest_unsafe: int64, info: int64): boolean
        /* gdvirtual */ _collide_shape(shape_rid: RID, transform: Transform3D, motion: Vector3, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, results: int64, max_results: int64, result_count: int64): boolean
        /* gdvirtual */ _rest_info(shape_rid: RID, transform: Transform3D, motion: Vector3, margin: float64, collision_mask: int64, collide_with_bodies: boolean, collide_with_areas: boolean, rest_info: int64): boolean
        /* gdvirtual */ _get_closest_point_to_object_volume(object: RID, point: Vector3): Vector3
        is_body_excluded_from_query(body: RID): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsDirectSpaceState3DExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsMaterial extends __NameMapResource {
    }
    /** Holds physics-related properties of a surface, namely its roughness and bounciness.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsmaterial.html  
     */
    class PhysicsMaterial extends Resource {
        constructor(identifier?: any)
        /** The body's friction. Values range from `0` (frictionless) to `1` (maximum friction). */
        get friction(): float64
        set friction(value: float64)
        
        /** If `true`, the physics engine will use the friction of the object marked as "rough" when two objects collide. If `false`, the physics engine will use the lowest friction of all colliding objects instead. If `true` for both colliding objects, the physics engine will use the highest friction. */
        get rough(): boolean
        set rough(value: boolean)
        
        /** The body's bounciness. Values range from `0` (no bounce) to `1` (full bounciness).  
         *      
         *  **Note:** Even with [member bounce] set to `1.0`, some energy will be lost over time due to linear and angular damping. To have a physics body that preserves all its energy over time, set [member bounce] to `1.0`, the body's linear damp mode to **Replace** (if applicable), its linear damp to `0.0`, its angular damp mode to **Replace** (if applicable), and its angular damp to `0.0`.  
         */
        get bounce(): float64
        set bounce(value: float64)
        
        /** If `true`, subtracts the bounciness from the colliding object's bounciness instead of adding it. */
        get absorbent(): boolean
        set absorbent(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsMaterial;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsPointQueryParameters2D extends __NameMapRefCounted {
    }
    /** Provides parameters for [method PhysicsDirectSpaceState2D.intersect_point].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicspointqueryparameters2d.html  
     */
    class PhysicsPointQueryParameters2D extends RefCounted {
        constructor(identifier?: any)
        /** The position being queried for, in global coordinates. */
        get position(): Vector2
        set position(value: Vector2)
        
        /** If different from `0`, restricts the query to a specific canvas layer specified by its instance ID. See [method Object.get_instance_id].  
         *  If `0`, restricts the query to the Viewport's default canvas layer.  
         */
        get canvas_instance_id(): int64
        set canvas_instance_id(value: int64)
        
        /** The physics layers the query will detect (as a bitmask). By default, all collision layers are detected. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The list of object [RID]s that will be excluded from collisions. Use [method CollisionObject2D.get_rid] to get the [RID] associated with a [CollisionObject2D]-derived node.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then assign it to the property again.  
         */
        get exclude(): GArray<RID>
        set exclude(value: GArray<RID>)
        
        /** If `true`, the query will take [PhysicsBody2D]s into account. */
        get collide_with_bodies(): boolean
        set collide_with_bodies(value: boolean)
        
        /** If `true`, the query will take [Area2D]s into account. */
        get collide_with_areas(): boolean
        set collide_with_areas(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsPointQueryParameters2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsPointQueryParameters3D extends __NameMapRefCounted {
    }
    /** Provides parameters for [method PhysicsDirectSpaceState3D.intersect_point].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicspointqueryparameters3d.html  
     */
    class PhysicsPointQueryParameters3D extends RefCounted {
        constructor(identifier?: any)
        /** The position being queried for, in global coordinates. */
        get position(): Vector3
        set position(value: Vector3)
        
        /** The physics layers the query will detect (as a bitmask). By default, all collision layers are detected. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The list of object [RID]s that will be excluded from collisions. Use [method CollisionObject3D.get_rid] to get the [RID] associated with a [CollisionObject3D]-derived node.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then assign it to the property again.  
         */
        get exclude(): GArray<RID>
        set exclude(value: GArray<RID>)
        
        /** If `true`, the query will take [PhysicsBody3D]s into account. */
        get collide_with_bodies(): boolean
        set collide_with_bodies(value: boolean)
        
        /** If `true`, the query will take [Area3D]s into account. */
        get collide_with_areas(): boolean
        set collide_with_areas(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsPointQueryParameters3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsRayQueryParameters2D extends __NameMapRefCounted {
    }
    /** Provides parameters for [method PhysicsDirectSpaceState2D.intersect_ray].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsrayqueryparameters2d.html  
     */
    class PhysicsRayQueryParameters2D extends RefCounted {
        constructor(identifier?: any)
        /** Returns a new, pre-configured [PhysicsRayQueryParameters2D] object. Use it to quickly create query parameters using the most common options.  
         *    
         */
        static create(from: Vector2, to: Vector2, collision_mask?: int64 /* = 4294967295 */, exclude?: GArray<RID>): PhysicsRayQueryParameters2D
        
        /** The starting point of the ray being queried for, in global coordinates. */
        get from(): Vector2
        set from(value: Vector2)
        
        /** The ending point of the ray being queried for, in global coordinates. */
        get to(): Vector2
        set to(value: Vector2)
        
        /** The physics layers the query will detect (as a bitmask). By default, all collision layers are detected. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The list of object [RID]s that will be excluded from collisions. Use [method CollisionObject2D.get_rid] to get the [RID] associated with a [CollisionObject2D]-derived node.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then assign it to the property again.  
         */
        get exclude(): GArray<RID>
        set exclude(value: GArray<RID>)
        
        /** If `true`, the query will take [PhysicsBody2D]s into account. */
        get collide_with_bodies(): boolean
        set collide_with_bodies(value: boolean)
        
        /** If `true`, the query will take [Area2D]s into account. */
        get collide_with_areas(): boolean
        set collide_with_areas(value: boolean)
        
        /** If `true`, the query will detect a hit when starting inside shapes. In this case the collision normal will be `Vector2(0, 0)`. Does not affect concave polygon shapes. */
        get hit_from_inside(): boolean
        set hit_from_inside(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsRayQueryParameters2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsRayQueryParameters3D extends __NameMapRefCounted {
    }
    /** Provides parameters for [method PhysicsDirectSpaceState3D.intersect_ray].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsrayqueryparameters3d.html  
     */
    class PhysicsRayQueryParameters3D extends RefCounted {
        constructor(identifier?: any)
        /** Returns a new, pre-configured [PhysicsRayQueryParameters3D] object. Use it to quickly create query parameters using the most common options.  
         *    
         */
        static create(from: Vector3, to: Vector3, collision_mask?: int64 /* = 4294967295 */, exclude?: GArray<RID>): PhysicsRayQueryParameters3D
        
        /** The starting point of the ray being queried for, in global coordinates. */
        get from(): Vector3
        set from(value: Vector3)
        
        /** The ending point of the ray being queried for, in global coordinates. */
        get to(): Vector3
        set to(value: Vector3)
        
        /** The physics layers the query will detect (as a bitmask). By default, all collision layers are detected. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The list of object [RID]s that will be excluded from collisions. Use [method CollisionObject3D.get_rid] to get the [RID] associated with a [CollisionObject3D]-derived node.  
         *      
         *  **Note:** The returned array is copied and any changes to it will not update the original property value. To update the value you need to modify the returned array, and then assign it to the property again.  
         */
        get exclude(): GArray<RID>
        set exclude(value: GArray<RID>)
        
        /** If `true`, the query will take [PhysicsBody3D]s into account. */
        get collide_with_bodies(): boolean
        set collide_with_bodies(value: boolean)
        
        /** If `true`, the query will take [Area3D]s into account. */
        get collide_with_areas(): boolean
        set collide_with_areas(value: boolean)
        
        /** If `true`, the query will detect a hit when starting inside shapes. In this case the collision normal will be `Vector3(0, 0, 0)`. Does not affect concave polygon shapes or heightmap shapes. */
        get hit_from_inside(): boolean
        set hit_from_inside(value: boolean)
        
        /** If `true`, the query will hit back faces with concave polygon shapes with back face enabled or heightmap shapes. */
        get hit_back_faces(): boolean
        set hit_back_faces(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsRayQueryParameters3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsServer2DExtension extends __NameMapPhysicsServer2D {
    }
    /** Provides virtual methods that can be overridden to create custom [PhysicsServer2D] implementations.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsserver2dextension.html  
     */
    class PhysicsServer2DExtension extends PhysicsServer2D {
        constructor(identifier?: any)
        /** Overridable version of [method PhysicsServer2D.world_boundary_shape_create]. */
        /* gdvirtual */ _world_boundary_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.separation_ray_shape_create]. */
        /* gdvirtual */ _separation_ray_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.segment_shape_create]. */
        /* gdvirtual */ _segment_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.circle_shape_create]. */
        /* gdvirtual */ _circle_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.rectangle_shape_create]. */
        /* gdvirtual */ _rectangle_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.capsule_shape_create]. */
        /* gdvirtual */ _capsule_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.convex_polygon_shape_create]. */
        /* gdvirtual */ _convex_polygon_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.concave_polygon_shape_create]. */
        /* gdvirtual */ _concave_polygon_shape_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.shape_set_data]. */
        /* gdvirtual */ _shape_set_data(shape: RID, data: any): void
        
        /** Should set the custom solver bias for the given [param shape]. It defines how much bodies are forced to separate on contact.  
         *  Overridable version of [PhysicsServer2D]'s internal `shape_get_custom_solver_bias` method. Corresponds to [member Shape2D.custom_solver_bias].  
         */
        /* gdvirtual */ _shape_set_custom_solver_bias(shape: RID, bias: float64): void
        
        /** Overridable version of [method PhysicsServer2D.shape_get_type]. */
        /* gdvirtual */ _shape_get_type(shape: RID): PhysicsServer2D.ShapeType
        
        /** Overridable version of [method PhysicsServer2D.shape_get_data]. */
        /* gdvirtual */ _shape_get_data(shape: RID): any
        
        /** Should return the custom solver bias of the given [param shape], which defines how much bodies are forced to separate on contact when this shape is involved.  
         *  Overridable version of [PhysicsServer2D]'s internal `shape_get_custom_solver_bias` method. Corresponds to [member Shape2D.custom_solver_bias].  
         */
        /* gdvirtual */ _shape_get_custom_solver_bias(shape: RID): float64
        
        /** Given two shapes and their parameters, should return `true` if a collision between the two would occur, with additional details passed in [param results].  
         *  Overridable version of [PhysicsServer2D]'s internal `shape_collide` method. Corresponds to [method PhysicsDirectSpaceState2D.collide_shape].  
         */
        /* gdvirtual */ _shape_collide(shape_A: RID, xform_A: Transform2D, motion_A: Vector2, shape_B: RID, xform_B: Transform2D, motion_B: Vector2, results: int64, result_max: int64, result_count: int64): boolean
        
        /** Overridable version of [method PhysicsServer2D.space_create]. */
        /* gdvirtual */ _space_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.space_set_active]. */
        /* gdvirtual */ _space_set_active(space: RID, active: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.space_is_active]. */
        /* gdvirtual */ _space_is_active(space: RID): boolean
        
        /** Overridable version of [method PhysicsServer2D.space_set_param]. */
        /* gdvirtual */ _space_set_param(space: RID, param: PhysicsServer2D.SpaceParameter, value: float64): void
        
        /** Overridable version of [method PhysicsServer2D.space_get_param]. */
        /* gdvirtual */ _space_get_param(space: RID, param: PhysicsServer2D.SpaceParameter): float64
        
        /** Overridable version of [method PhysicsServer2D.space_get_direct_state]. */
        /* gdvirtual */ _space_get_direct_state(space: RID): null | PhysicsDirectSpaceState2D
        
        /** Used internally to allow the given [param space] to store contact points, up to [param max_contacts]. This is automatically set for the main [World2D]'s space when [member SceneTree.debug_collisions_hint] is `true`, or by checking "Visible Collision Shapes" in the editor. Only works in debug builds.  
         *  Overridable version of [PhysicsServer2D]'s internal `space_set_debug_contacts` method.  
         */
        /* gdvirtual */ _space_set_debug_contacts(space: RID, max_contacts: int64): void
        
        /** Should return the positions of all contacts that have occurred during the last physics step in the given [param space]. See also [method _space_get_contact_count] and [method _space_set_debug_contacts].  
         *  Overridable version of [PhysicsServer2D]'s internal `space_get_contacts` method.  
         */
        /* gdvirtual */ _space_get_contacts(space: RID): PackedVector2Array
        
        /** Should return how many contacts have occurred during the last physics step in the given [param space]. See also [method _space_get_contacts] and [method _space_set_debug_contacts].  
         *  Overridable version of [PhysicsServer2D]'s internal `space_get_contact_count` method.  
         */
        /* gdvirtual */ _space_get_contact_count(space: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.area_create]. */
        /* gdvirtual */ _area_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.area_set_space]. */
        /* gdvirtual */ _area_set_space(area: RID, space: RID): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_space]. */
        /* gdvirtual */ _area_get_space(area: RID): RID
        
        /** Overridable version of [method PhysicsServer2D.area_add_shape]. */
        /* gdvirtual */ _area_add_shape(area: RID, shape: RID, transform: Transform2D, disabled: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.area_set_shape]. */
        /* gdvirtual */ _area_set_shape(area: RID, shape_idx: int64, shape: RID): void
        
        /** Overridable version of [method PhysicsServer2D.area_set_shape_transform]. */
        /* gdvirtual */ _area_set_shape_transform(area: RID, shape_idx: int64, transform: Transform2D): void
        
        /** Overridable version of [method PhysicsServer2D.area_set_shape_disabled]. */
        /* gdvirtual */ _area_set_shape_disabled(area: RID, shape_idx: int64, disabled: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_shape_count]. */
        /* gdvirtual */ _area_get_shape_count(area: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.area_get_shape]. */
        /* gdvirtual */ _area_get_shape(area: RID, shape_idx: int64): RID
        
        /** Overridable version of [method PhysicsServer2D.area_get_shape_transform]. */
        /* gdvirtual */ _area_get_shape_transform(area: RID, shape_idx: int64): Transform2D
        
        /** Overridable version of [method PhysicsServer2D.area_remove_shape]. */
        /* gdvirtual */ _area_remove_shape(area: RID, shape_idx: int64): void
        
        /** Overridable version of [method PhysicsServer2D.area_clear_shapes]. */
        /* gdvirtual */ _area_clear_shapes(area: RID): void
        
        /** Overridable version of [method PhysicsServer2D.area_attach_object_instance_id]. */
        /* gdvirtual */ _area_attach_object_instance_id(area: RID, id: int64): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_object_instance_id]. */
        /* gdvirtual */ _area_get_object_instance_id(area: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.area_attach_canvas_instance_id]. */
        /* gdvirtual */ _area_attach_canvas_instance_id(area: RID, id: int64): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_canvas_instance_id]. */
        /* gdvirtual */ _area_get_canvas_instance_id(area: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.area_set_param]. */
        /* gdvirtual */ _area_set_param(area: RID, param: PhysicsServer2D.AreaParameter, value: any): void
        
        /** Overridable version of [method PhysicsServer2D.area_set_transform]. */
        /* gdvirtual */ _area_set_transform(area: RID, transform: Transform2D): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_param]. */
        /* gdvirtual */ _area_get_param(area: RID, param: PhysicsServer2D.AreaParameter): any
        
        /** Overridable version of [method PhysicsServer2D.area_get_transform]. */
        /* gdvirtual */ _area_get_transform(area: RID): Transform2D
        
        /** Overridable version of [method PhysicsServer2D.area_set_collision_layer]. */
        /* gdvirtual */ _area_set_collision_layer(area: RID, layer: int64): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_collision_layer]. */
        /* gdvirtual */ _area_get_collision_layer(area: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.area_set_collision_mask]. */
        /* gdvirtual */ _area_set_collision_mask(area: RID, mask: int64): void
        
        /** Overridable version of [method PhysicsServer2D.area_get_collision_mask]. */
        /* gdvirtual */ _area_get_collision_mask(area: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.area_set_monitorable]. */
        /* gdvirtual */ _area_set_monitorable(area: RID, monitorable: boolean): void
        
        /** If set to `true`, allows the area with the given [RID] to detect mouse inputs when the mouse cursor is hovering on it.  
         *  Overridable version of [PhysicsServer2D]'s internal `area_set_pickable` method. Corresponds to [member CollisionObject2D.input_pickable].  
         */
        /* gdvirtual */ _area_set_pickable(area: RID, pickable: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.area_set_monitor_callback]. */
        /* gdvirtual */ _area_set_monitor_callback(area: RID, callback: Callable): void
        
        /** Overridable version of [method PhysicsServer2D.area_set_area_monitor_callback]. */
        /* gdvirtual */ _area_set_area_monitor_callback(area: RID, callback: Callable): void
        
        /** Overridable version of [method PhysicsServer2D.body_create]. */
        /* gdvirtual */ _body_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.body_set_space]. */
        /* gdvirtual */ _body_set_space(body: RID, space: RID): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_space]. */
        /* gdvirtual */ _body_get_space(body: RID): RID
        
        /** Overridable version of [method PhysicsServer2D.body_set_mode]. */
        /* gdvirtual */ _body_set_mode(body: RID, mode: PhysicsServer2D.BodyMode): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_mode]. */
        /* gdvirtual */ _body_get_mode(body: RID): PhysicsServer2D.BodyMode
        
        /** Overridable version of [method PhysicsServer2D.body_add_shape]. */
        /* gdvirtual */ _body_add_shape(body: RID, shape: RID, transform: Transform2D, disabled: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.body_set_shape]. */
        /* gdvirtual */ _body_set_shape(body: RID, shape_idx: int64, shape: RID): void
        
        /** Overridable version of [method PhysicsServer2D.body_set_shape_transform]. */
        /* gdvirtual */ _body_set_shape_transform(body: RID, shape_idx: int64, transform: Transform2D): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_shape_count]. */
        /* gdvirtual */ _body_get_shape_count(body: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.body_get_shape]. */
        /* gdvirtual */ _body_get_shape(body: RID, shape_idx: int64): RID
        
        /** Overridable version of [method PhysicsServer2D.body_get_shape_transform]. */
        /* gdvirtual */ _body_get_shape_transform(body: RID, shape_idx: int64): Transform2D
        
        /** Overridable version of [method PhysicsServer2D.body_set_shape_disabled]. */
        /* gdvirtual */ _body_set_shape_disabled(body: RID, shape_idx: int64, disabled: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.body_set_shape_as_one_way_collision]. */
        /* gdvirtual */ _body_set_shape_as_one_way_collision(body: RID, shape_idx: int64, enable: boolean, margin: float64): void
        
        /** Overridable version of [method PhysicsServer2D.body_remove_shape]. */
        /* gdvirtual */ _body_remove_shape(body: RID, shape_idx: int64): void
        
        /** Overridable version of [method PhysicsServer2D.body_clear_shapes]. */
        /* gdvirtual */ _body_clear_shapes(body: RID): void
        
        /** Overridable version of [method PhysicsServer2D.body_attach_object_instance_id]. */
        /* gdvirtual */ _body_attach_object_instance_id(body: RID, id: int64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_object_instance_id]. */
        /* gdvirtual */ _body_get_object_instance_id(body: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.body_attach_canvas_instance_id]. */
        /* gdvirtual */ _body_attach_canvas_instance_id(body: RID, id: int64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_canvas_instance_id]. */
        /* gdvirtual */ _body_get_canvas_instance_id(body: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.body_set_continuous_collision_detection_mode]. */
        /* gdvirtual */ _body_set_continuous_collision_detection_mode(body: RID, mode: PhysicsServer2D.CCDMode): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_continuous_collision_detection_mode]. */
        /* gdvirtual */ _body_get_continuous_collision_detection_mode(body: RID): PhysicsServer2D.CCDMode
        
        /** Overridable version of [method PhysicsServer2D.body_set_collision_layer]. */
        /* gdvirtual */ _body_set_collision_layer(body: RID, layer: int64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_collision_layer]. */
        /* gdvirtual */ _body_get_collision_layer(body: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.body_set_collision_mask]. */
        /* gdvirtual */ _body_set_collision_mask(body: RID, mask: int64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_collision_mask]. */
        /* gdvirtual */ _body_get_collision_mask(body: RID): int64
        
        /** Overridable version of [method PhysicsServer2D.body_set_collision_priority]. */
        /* gdvirtual */ _body_set_collision_priority(body: RID, priority: float64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_collision_priority]. */
        /* gdvirtual */ _body_get_collision_priority(body: RID): float64
        
        /** Overridable version of [method PhysicsServer2D.body_set_param]. */
        /* gdvirtual */ _body_set_param(body: RID, param: PhysicsServer2D.BodyParameter, value: any): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_param]. */
        /* gdvirtual */ _body_get_param(body: RID, param: PhysicsServer2D.BodyParameter): any
        
        /** Overridable version of [method PhysicsServer2D.body_reset_mass_properties]. */
        /* gdvirtual */ _body_reset_mass_properties(body: RID): void
        
        /** Overridable version of [method PhysicsServer2D.body_set_state]. */
        /* gdvirtual */ _body_set_state(body: RID, state: PhysicsServer2D.BodyState, value: any): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_state]. */
        /* gdvirtual */ _body_get_state(body: RID, state: PhysicsServer2D.BodyState): any
        
        /** Overridable version of [method PhysicsServer2D.body_apply_central_impulse]. */
        /* gdvirtual */ _body_apply_central_impulse(body: RID, impulse: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_apply_torque_impulse]. */
        /* gdvirtual */ _body_apply_torque_impulse(body: RID, impulse: float64): void
        
        /** Overridable version of [method PhysicsServer2D.body_apply_impulse]. */
        /* gdvirtual */ _body_apply_impulse(body: RID, impulse: Vector2, position: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_apply_central_force]. */
        /* gdvirtual */ _body_apply_central_force(body: RID, force: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_apply_force]. */
        /* gdvirtual */ _body_apply_force(body: RID, force: Vector2, position: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_apply_torque]. */
        /* gdvirtual */ _body_apply_torque(body: RID, torque: float64): void
        
        /** Overridable version of [method PhysicsServer2D.body_add_constant_central_force]. */
        /* gdvirtual */ _body_add_constant_central_force(body: RID, force: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_add_constant_force]. */
        /* gdvirtual */ _body_add_constant_force(body: RID, force: Vector2, position: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_add_constant_torque]. */
        /* gdvirtual */ _body_add_constant_torque(body: RID, torque: float64): void
        
        /** Overridable version of [method PhysicsServer2D.body_set_constant_force]. */
        /* gdvirtual */ _body_set_constant_force(body: RID, force: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_constant_force]. */
        /* gdvirtual */ _body_get_constant_force(body: RID): Vector2
        
        /** Overridable version of [method PhysicsServer2D.body_set_constant_torque]. */
        /* gdvirtual */ _body_set_constant_torque(body: RID, torque: float64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_constant_torque]. */
        /* gdvirtual */ _body_get_constant_torque(body: RID): float64
        
        /** Overridable version of [method PhysicsServer2D.body_set_axis_velocity]. */
        /* gdvirtual */ _body_set_axis_velocity(body: RID, axis_velocity: Vector2): void
        
        /** Overridable version of [method PhysicsServer2D.body_add_collision_exception]. */
        /* gdvirtual */ _body_add_collision_exception(body: RID, excepted_body: RID): void
        
        /** Overridable version of [method PhysicsServer2D.body_remove_collision_exception]. */
        /* gdvirtual */ _body_remove_collision_exception(body: RID, excepted_body: RID): void
        
        /** Returns the [RID]s of all bodies added as collision exceptions for the given [param body]. See also [method _body_add_collision_exception] and [method _body_remove_collision_exception].  
         *  Overridable version of [PhysicsServer2D]'s internal `body_get_collision_exceptions` method. Corresponds to [method PhysicsBody2D.get_collision_exceptions].  
         */
        /* gdvirtual */ _body_get_collision_exceptions(body: RID): GArray<RID>
        
        /** Overridable version of [method PhysicsServer2D.body_set_max_contacts_reported]. */
        /* gdvirtual */ _body_set_max_contacts_reported(body: RID, amount: int64): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_max_contacts_reported]. */
        /* gdvirtual */ _body_get_max_contacts_reported(body: RID): int64
        
        /** Overridable version of [PhysicsServer2D]'s internal `body_set_contacts_reported_depth_threshold` method.  
         *      
         *  **Note:** This method is currently unused by Godot's default physics implementation.  
         */
        /* gdvirtual */ _body_set_contacts_reported_depth_threshold(body: RID, threshold: float64): void
        
        /** Overridable version of [PhysicsServer2D]'s internal `body_get_contacts_reported_depth_threshold` method.  
         *      
         *  **Note:** This method is currently unused by Godot's default physics implementation.  
         */
        /* gdvirtual */ _body_get_contacts_reported_depth_threshold(body: RID): float64
        
        /** Overridable version of [method PhysicsServer2D.body_set_omit_force_integration]. */
        /* gdvirtual */ _body_set_omit_force_integration(body: RID, enable: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.body_is_omitting_force_integration]. */
        /* gdvirtual */ _body_is_omitting_force_integration(body: RID): boolean
        
        /** Assigns the [param body] to call the given [param callable] during the synchronization phase of the loop, before [method _step] is called. See also [method _sync].  
         *  Overridable version of [method PhysicsServer2D.body_set_state_sync_callback].  
         */
        /* gdvirtual */ _body_set_state_sync_callback(body: RID, callable: Callable): void
        
        /** Overridable version of [method PhysicsServer2D.body_set_force_integration_callback]. */
        /* gdvirtual */ _body_set_force_integration_callback(body: RID, callable: Callable, userdata: any): void
        
        /** Given a [param body], a [param shape], and their respective parameters, this method should return `true` if a collision between the two would occur, with additional details passed in [param results].  
         *  Overridable version of [PhysicsServer2D]'s internal `shape_collide` method. Corresponds to [method PhysicsDirectSpaceState2D.collide_shape].  
         */
        /* gdvirtual */ _body_collide_shape(body: RID, body_shape: int64, shape: RID, shape_xform: Transform2D, motion: Vector2, results: int64, result_max: int64, result_count: int64): boolean
        
        /** If set to `true`, allows the body with the given [RID] to detect mouse inputs when the mouse cursor is hovering on it.  
         *  Overridable version of [PhysicsServer2D]'s internal `body_set_pickable` method. Corresponds to [member CollisionObject2D.input_pickable].  
         */
        /* gdvirtual */ _body_set_pickable(body: RID, pickable: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.body_get_direct_state]. */
        /* gdvirtual */ _body_get_direct_state(body: RID): null | PhysicsDirectBodyState2D
        
        /** Overridable version of [method PhysicsServer2D.body_test_motion]. Unlike the exposed implementation, this method does not receive all of the arguments inside a [PhysicsTestMotionParameters2D]. */
        /* gdvirtual */ _body_test_motion(body: RID, from: Transform2D, motion: Vector2, margin: float64, collide_separation_ray: boolean, recovery_as_collision: boolean, result: int64): boolean
        
        /** Overridable version of [method PhysicsServer2D.joint_create]. */
        /* gdvirtual */ _joint_create(): RID
        
        /** Overridable version of [method PhysicsServer2D.joint_clear]. */
        /* gdvirtual */ _joint_clear(joint: RID): void
        
        /** Overridable version of [method PhysicsServer2D.joint_set_param]. */
        /* gdvirtual */ _joint_set_param(joint: RID, param: PhysicsServer2D.JointParam, value: float64): void
        
        /** Overridable version of [method PhysicsServer2D.joint_get_param]. */
        /* gdvirtual */ _joint_get_param(joint: RID, param: PhysicsServer2D.JointParam): float64
        
        /** Overridable version of [method PhysicsServer2D.joint_disable_collisions_between_bodies]. */
        /* gdvirtual */ _joint_disable_collisions_between_bodies(joint: RID, disable: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.joint_is_disabled_collisions_between_bodies]. */
        /* gdvirtual */ _joint_is_disabled_collisions_between_bodies(joint: RID): boolean
        
        /** Overridable version of [method PhysicsServer2D.joint_make_pin]. */
        /* gdvirtual */ _joint_make_pin(joint: RID, anchor: Vector2, body_a: RID, body_b: RID): void
        
        /** Overridable version of [method PhysicsServer2D.joint_make_groove]. */
        /* gdvirtual */ _joint_make_groove(joint: RID, a_groove1: Vector2, a_groove2: Vector2, b_anchor: Vector2, body_a: RID, body_b: RID): void
        
        /** Overridable version of [method PhysicsServer2D.joint_make_damped_spring]. */
        /* gdvirtual */ _joint_make_damped_spring(joint: RID, anchor_a: Vector2, anchor_b: Vector2, body_a: RID, body_b: RID): void
        
        /** Overridable version of [method PhysicsServer2D.pin_joint_set_flag]. */
        /* gdvirtual */ _pin_joint_set_flag(joint: RID, flag: PhysicsServer2D.PinJointFlag, enabled: boolean): void
        
        /** Overridable version of [method PhysicsServer2D.pin_joint_get_flag]. */
        /* gdvirtual */ _pin_joint_get_flag(joint: RID, flag: PhysicsServer2D.PinJointFlag): boolean
        
        /** Overridable version of [method PhysicsServer2D.pin_joint_set_param]. */
        /* gdvirtual */ _pin_joint_set_param(joint: RID, param: PhysicsServer2D.PinJointParam, value: float64): void
        
        /** Overridable version of [method PhysicsServer2D.pin_joint_get_param]. */
        /* gdvirtual */ _pin_joint_get_param(joint: RID, param: PhysicsServer2D.PinJointParam): float64
        
        /** Overridable version of [method PhysicsServer2D.damped_spring_joint_set_param]. */
        /* gdvirtual */ _damped_spring_joint_set_param(joint: RID, param: PhysicsServer2D.DampedSpringParam, value: float64): void
        
        /** Overridable version of [method PhysicsServer2D.damped_spring_joint_get_param]. */
        /* gdvirtual */ _damped_spring_joint_get_param(joint: RID, param: PhysicsServer2D.DampedSpringParam): float64
        
        /** Overridable version of [method PhysicsServer2D.joint_get_type]. */
        /* gdvirtual */ _joint_get_type(joint: RID): PhysicsServer2D.JointType
        
        /** Overridable version of [method PhysicsServer2D.free_rid]. */
        /* gdvirtual */ _free_rid(rid: RID): void
        
        /** Overridable version of [method PhysicsServer2D.set_active]. */
        /* gdvirtual */ _set_active(active: boolean): void
        
        /** Called when the main loop is initialized and creates a new instance of this physics server. See also [method MainLoop._initialize] and [method _finish].  
         *  Overridable version of [PhysicsServer2D]'s internal `init` method.  
         */
        /* gdvirtual */ _init(): void
        
        /** Called every physics step to process the physics simulation. [param step] is the time elapsed since the last physics step, in seconds. It is usually the same as the value returned by [method Node.get_physics_process_delta_time].  
         *  Overridable version of [PhysicsServer2D]'s internal [code skip-lint]step` method.  
         */
        /* gdvirtual */ _step(step: float64): void
        
        /** Called to indicate that the physics server is synchronizing and cannot access physics states if running on a separate thread. See also [method _end_sync].  
         *  Overridable version of [PhysicsServer2D]'s internal `sync` method.  
         */
        /* gdvirtual */ _sync(): void
        
        /** Called every physics step before [method _step] to process all remaining queries.  
         *  Overridable version of [PhysicsServer2D]'s internal `flush_queries` method.  
         */
        /* gdvirtual */ _flush_queries(): void
        
        /** Called to indicate that the physics server has stopped synchronizing. It is in the loop's iteration/physics phase, and can access physics objects even if running on a separate thread. See also [method _sync].  
         *  Overridable version of [PhysicsServer2D]'s internal `end_sync` method.  
         */
        /* gdvirtual */ _end_sync(): void
        
        /** Called when the main loop finalizes to shut down the physics server. See also [method MainLoop._finalize] and [method _init].  
         *  Overridable version of [PhysicsServer2D]'s internal `finish` method.  
         */
        /* gdvirtual */ _finish(): void
        
        /** Overridable method that should return `true` when the physics server is processing queries. See also [method _flush_queries].  
         *  Overridable version of [PhysicsServer2D]'s internal `is_flushing_queries` method.  
         */
        /* gdvirtual */ _is_flushing_queries(): boolean
        
        /** Overridable version of [method PhysicsServer2D.get_process_info]. */
        /* gdvirtual */ _get_process_info(process_info: PhysicsServer2D.ProcessInfo): int64
        
        /** Returns `true` if the body with the given [RID] is being excluded from [method _body_test_motion]. See also [method Object.get_instance_id]. */
        body_test_motion_is_excluding_body(body: RID): boolean
        
        /** Returns `true` if the object with the given instance ID is being excluded from [method _body_test_motion]. See also [method Object.get_instance_id]. */
        body_test_motion_is_excluding_object(object: int64): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsServer2DExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapPhysicsServer3DExtension extends __NameMapPhysicsServer3D {
    }
    /** Provides virtual methods that can be overridden to create custom [PhysicsServer3D] implementations.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_physicsserver3dextension.html  
     */
    class PhysicsServer3DExtension extends PhysicsServer3D {
        constructor(identifier?: any)
        /* gdvirtual */ _world_boundary_shape_create(): RID
        /* gdvirtual */ _separation_ray_shape_create(): RID
        /* gdvirtual */ _sphere_shape_create(): RID
        /* gdvirtual */ _box_shape_create(): RID
        /* gdvirtual */ _capsule_shape_create(): RID
        /* gdvirtual */ _cylinder_shape_create(): RID
        /* gdvirtual */ _convex_polygon_shape_create(): RID
        /* gdvirtual */ _concave_polygon_shape_create(): RID
        /* gdvirtual */ _heightmap_shape_create(): RID
        /* gdvirtual */ _custom_shape_create(): RID
        /* gdvirtual */ _shape_set_data(shape: RID, data: any): void
        /* gdvirtual */ _shape_set_custom_solver_bias(shape: RID, bias: float64): void
        /* gdvirtual */ _shape_set_margin(shape: RID, margin: float64): void
        /* gdvirtual */ _shape_get_margin(shape: RID): float64
        /* gdvirtual */ _shape_get_type(shape: RID): PhysicsServer3D.ShapeType
        /* gdvirtual */ _shape_get_data(shape: RID): any
        /* gdvirtual */ _shape_get_custom_solver_bias(shape: RID): float64
        /* gdvirtual */ _space_create(): RID
        /* gdvirtual */ _space_set_active(space: RID, active: boolean): void
        /* gdvirtual */ _space_is_active(space: RID): boolean
        /* gdvirtual */ _space_set_param(space: RID, param: PhysicsServer3D.SpaceParameter, value: float64): void
        /* gdvirtual */ _space_get_param(space: RID, param: PhysicsServer3D.SpaceParameter): float64
        /* gdvirtual */ _space_get_direct_state(space: RID): null | PhysicsDirectSpaceState3D
        /* gdvirtual */ _space_set_debug_contacts(space: RID, max_contacts: int64): void
        /* gdvirtual */ _space_get_contacts(space: RID): PackedVector3Array
        /* gdvirtual */ _space_get_contact_count(space: RID): int64
        /* gdvirtual */ _area_create(): RID
        /* gdvirtual */ _area_set_space(area: RID, space: RID): void
        /* gdvirtual */ _area_get_space(area: RID): RID
        /* gdvirtual */ _area_add_shape(area: RID, shape: RID, transform: Transform3D, disabled: boolean): void
        /* gdvirtual */ _area_set_shape(area: RID, shape_idx: int64, shape: RID): void
        /* gdvirtual */ _area_set_shape_transform(area: RID, shape_idx: int64, transform: Transform3D): void
        /* gdvirtual */ _area_set_shape_disabled(area: RID, shape_idx: int64, disabled: boolean): void
        /* gdvirtual */ _area_get_shape_count(area: RID): int64
        /* gdvirtual */ _area_get_shape(area: RID, shape_idx: int64): RID
        /* gdvirtual */ _area_get_shape_transform(area: RID, shape_idx: int64): Transform3D
        /* gdvirtual */ _area_remove_shape(area: RID, shape_idx: int64): void
        /* gdvirtual */ _area_clear_shapes(area: RID): void
        /* gdvirtual */ _area_attach_object_instance_id(area: RID, id: int64): void
        /* gdvirtual */ _area_get_object_instance_id(area: RID): int64
        /* gdvirtual */ _area_set_param(area: RID, param: PhysicsServer3D.AreaParameter, value: any): void
        /* gdvirtual */ _area_set_transform(area: RID, transform: Transform3D): void
        /* gdvirtual */ _area_get_param(area: RID, param: PhysicsServer3D.AreaParameter): any
        /* gdvirtual */ _area_get_transform(area: RID): Transform3D
        /* gdvirtual */ _area_set_collision_layer(area: RID, layer: int64): void
        /* gdvirtual */ _area_get_collision_layer(area: RID): int64
        /* gdvirtual */ _area_set_collision_mask(area: RID, mask: int64): void
        /* gdvirtual */ _area_get_collision_mask(area: RID): int64
        /* gdvirtual */ _area_set_monitorable(area: RID, monitorable: boolean): void
        /* gdvirtual */ _area_set_ray_pickable(area: RID, enable: boolean): void
        /* gdvirtual */ _area_set_monitor_callback(area: RID, callback: Callable): void
        /* gdvirtual */ _area_set_area_monitor_callback(area: RID, callback: Callable): void
        /* gdvirtual */ _body_create(): RID
        /* gdvirtual */ _body_set_space(body: RID, space: RID): void
        /* gdvirtual */ _body_get_space(body: RID): RID
        /* gdvirtual */ _body_set_mode(body: RID, mode: PhysicsServer3D.BodyMode): void
        /* gdvirtual */ _body_get_mode(body: RID): PhysicsServer3D.BodyMode
        /* gdvirtual */ _body_add_shape(body: RID, shape: RID, transform: Transform3D, disabled: boolean): void
        /* gdvirtual */ _body_set_shape(body: RID, shape_idx: int64, shape: RID): void
        /* gdvirtual */ _body_set_shape_transform(body: RID, shape_idx: int64, transform: Transform3D): void
        /* gdvirtual */ _body_set_shape_disabled(body: RID, shape_idx: int64, disabled: boolean): void
        /* gdvirtual */ _body_get_shape_count(body: RID): int64
        /* gdvirtual */ _body_get_shape(body: RID, shape_idx: int64): RID
        /* gdvirtual */ _body_get_shape_transform(body: RID, shape_idx: int64): Transform3D
        /* gdvirtual */ _body_remove_shape(body: RID, shape_idx: int64): void
        /* gdvirtual */ _body_clear_shapes(body: RID): void
        /* gdvirtual */ _body_attach_object_instance_id(body: RID, id: int64): void
        /* gdvirtual */ _body_get_object_instance_id(body: RID): int64
        /* gdvirtual */ _body_set_enable_continuous_collision_detection(body: RID, enable: boolean): void
        /* gdvirtual */ _body_is_continuous_collision_detection_enabled(body: RID): boolean
        /* gdvirtual */ _body_set_collision_layer(body: RID, layer: int64): void
        /* gdvirtual */ _body_get_collision_layer(body: RID): int64
        /* gdvirtual */ _body_set_collision_mask(body: RID, mask: int64): void
        /* gdvirtual */ _body_get_collision_mask(body: RID): int64
        /* gdvirtual */ _body_set_collision_priority(body: RID, priority: float64): void
        /* gdvirtual */ _body_get_collision_priority(body: RID): float64
        /* gdvirtual */ _body_set_user_flags(body: RID, flags: int64): void
        /* gdvirtual */ _body_get_user_flags(body: RID): int64
        /* gdvirtual */ _body_set_param(body: RID, param: PhysicsServer3D.BodyParameter, value: any): void
        /* gdvirtual */ _body_get_param(body: RID, param: PhysicsServer3D.BodyParameter): any
        /* gdvirtual */ _body_reset_mass_properties(body: RID): void
        /* gdvirtual */ _body_set_state(body: RID, state: PhysicsServer3D.BodyState, value: any): void
        /* gdvirtual */ _body_get_state(body: RID, state: PhysicsServer3D.BodyState): any
        /* gdvirtual */ _body_apply_central_impulse(body: RID, impulse: Vector3): void
        /* gdvirtual */ _body_apply_impulse(body: RID, impulse: Vector3, position: Vector3): void
        /* gdvirtual */ _body_apply_torque_impulse(body: RID, impulse: Vector3): void
        /* gdvirtual */ _body_apply_central_force(body: RID, force: Vector3): void
        /* gdvirtual */ _body_apply_force(body: RID, force: Vector3, position: Vector3): void
        /* gdvirtual */ _body_apply_torque(body: RID, torque: Vector3): void
        /* gdvirtual */ _body_add_constant_central_force(body: RID, force: Vector3): void
        /* gdvirtual */ _body_add_constant_force(body: RID, force: Vector3, position: Vector3): void
        /* gdvirtual */ _body_add_constant_torque(body: RID, torque: Vector3): void
        /* gdvirtual */ _body_set_constant_force(body: RID, force: Vector3): void
        /* gdvirtual */ _body_get_constant_force(body: RID): Vector3
        /* gdvirtual */ _body_set_constant_torque(body: RID, torque: Vector3): void
        /* gdvirtual */ _body_get_constant_torque(body: RID): Vector3
        /* gdvirtual */ _body_set_axis_velocity(body: RID, axis_velocity: Vector3): void
        /* gdvirtual */ _body_set_axis_lock(body: RID, axis: PhysicsServer3D.BodyAxis, lock: boolean): void
        /* gdvirtual */ _body_is_axis_locked(body: RID, axis: PhysicsServer3D.BodyAxis): boolean
        /* gdvirtual */ _body_add_collision_exception(body: RID, excepted_body: RID): void
        /* gdvirtual */ _body_remove_collision_exception(body: RID, excepted_body: RID): void
        /* gdvirtual */ _body_get_collision_exceptions(body: RID): GArray<RID>
        /* gdvirtual */ _body_set_max_contacts_reported(body: RID, amount: int64): void
        /* gdvirtual */ _body_get_max_contacts_reported(body: RID): int64
        /* gdvirtual */ _body_set_contacts_reported_depth_threshold(body: RID, threshold: float64): void
        /* gdvirtual */ _body_get_contacts_reported_depth_threshold(body: RID): float64
        /* gdvirtual */ _body_set_omit_force_integration(body: RID, enable: boolean): void
        /* gdvirtual */ _body_is_omitting_force_integration(body: RID): boolean
        /* gdvirtual */ _body_set_state_sync_callback(body: RID, callable: Callable): void
        /* gdvirtual */ _body_set_force_integration_callback(body: RID, callable: Callable, userdata: any): void
        /* gdvirtual */ _body_set_ray_pickable(body: RID, enable: boolean): void
        /* gdvirtual */ _body_test_motion(body: RID, from: Transform3D, motion: Vector3, margin: float64, max_collisions: int64, collide_separation_ray: boolean, recovery_as_collision: boolean, result: int64): boolean
        /* gdvirtual */ _body_get_direct_state(body: RID): null | PhysicsDirectBodyState3D
        /* gdvirtual */ _soft_body_create(): RID
        /* gdvirtual */ _soft_body_update_rendering_server(body: RID, rendering_server_handler: PhysicsServer3DRenderingServerHandler): void
        /* gdvirtual */ _soft_body_set_space(body: RID, space: RID): void
        /* gdvirtual */ _soft_body_get_space(body: RID): RID
        /* gdvirtual */ _soft_body_set_ray_pickable(body: RID, enable: boolean): void
        /* gdvirtual */ _soft_body_set_collision_layer(body: RID, layer: int64): void
        /* gdvirtual */ _soft_body_get_collision_layer(body: RID): int64
        /* gdvirtual */ _soft_body_set_collision_mask(body: RID, mask: int64): void
        /* gdvirtual */ _soft_body_get_collision_mask(body: RID): int64
        /* gdvirtual */ _soft_body_add_collision_exception(body: RID, body_b: RID): void
        /* gdvirtual */ _soft_body_remove_collision_exception(body: RID, body_b: RID): void
        /* gdvirtual */ _soft_body_get_collision_exceptions(body: RID): GArray<RID>
        /* gdvirtual */ _soft_body_set_state(body: RID, state: PhysicsServer3D.BodyState, variant: any): void
        /* gdvirtual */ _soft_body_get_state(body: RID, state: PhysicsServer3D.BodyState): any
        /* gdvirtual */ _soft_body_set_transform(body: RID, transform: Transform3D): void
        /* gdvirtual */ _soft_body_set_simulation_precision(body: RID, simulation_precision: int64): void
        /* gdvirtual */ _soft_body_get_simulation_precision(body: RID): int64
        /* gdvirtual */ _soft_body_set_total_mass(body: RID, total_mass: float64): void
        /* gdvirtual */ _soft_body_get_total_mass(body: RID): float64
        /* gdvirtual */ _soft_body_set_linear_stiffness(body: RID, linear_stiffness: float64): void
        /* gdvirtual */ _soft_body_get_linear_stiffness(body: RID): float64
        /* gdvirtual */ _soft_body_set_shrinking_factor(body: RID, shrinking_factor: float64): void
        /* gdvirtual */ _soft_body_get_shrinking_factor(body: RID): float64
        /* gdvirtual */ _soft_body_set_pressure_coefficient(body: RID, pressure_coefficient: float64): void
        /* gdvirtual */ _soft_body_get_pressure_coefficient(body: RID): float64
        /* gdvirtual */ _soft_body_set_damping_coefficient(body: RID, damping_coefficient: float64): void
        /* gdvirtual */ _soft_body_get_damping_coefficient(body: RID): float64
        /* gdvirtual */ _soft_body_set_drag_coefficient(body: RID, drag_coefficient: float64): void
        /* gdvirtual */ _soft_body_get_drag_coefficient(body: RID): float64
        /* gdvirtual */ _soft_body_set_mesh(body: RID, mesh: RID): void
        /* gdvirtual */ _soft_body_get_bounds(body: RID): AABB
        /* gdvirtual */ _soft_body_move_point(body: RID, point_index: int64, global_position: Vector3): void
        /* gdvirtual */ _soft_body_get_point_global_position(body: RID, point_index: int64): Vector3
        /* gdvirtual */ _soft_body_remove_all_pinned_points(body: RID): void
        /* gdvirtual */ _soft_body_pin_point(body: RID, point_index: int64, pin: boolean): void
        /* gdvirtual */ _soft_body_is_point_pinned(body: RID, point_index: int64): boolean
        /* gdvirtual */ _soft_body_apply_point_impulse(body: RID, point_index: int64, impulse: Vector3): void
        /* gdvirtual */ _soft_body_apply_point_force(body: RID, point_index: int64, force: Vector3): void
        /* gdvirtual */ _soft_body_apply_central_impulse(body: RID, impulse: Vector3): void
        /* gdvirtual */ _soft_body_apply_central_force(body: RID, force: Vector3): void
        /* gdvirtual */ _joint_create(): RID
        /* gdvirtual */ _joint_clear(joint: RID): void
        /* gdvirtual */ _joint_make_pin(joint: RID, body_A: RID, local_A: Vector3, body_B: RID, local_B: Vector3): void
        /* gdvirtual */ _pin_joint_set_param(joint: RID, param: PhysicsServer3D.PinJointParam, value: float64): void
        /* gdvirtual */ _pin_joint_get_param(joint: RID, param: PhysicsServer3D.PinJointParam): float64
        /* gdvirtual */ _pin_joint_set_local_a(joint: RID, local_A: Vector3): void
        /* gdvirtual */ _pin_joint_get_local_a(joint: RID): Vector3
        /* gdvirtual */ _pin_joint_set_local_b(joint: RID, local_B: Vector3): void
        /* gdvirtual */ _pin_joint_get_local_b(joint: RID): Vector3
        /* gdvirtual */ _joint_make_hinge(joint: RID, body_A: RID, hinge_A: Transform3D, body_B: RID, hinge_B: Transform3D): void
        /* gdvirtual */ _joint_make_hinge_simple(joint: RID, body_A: RID, pivot_A: Vector3, axis_A: Vector3, body_B: RID, pivot_B: Vector3, axis_B: Vector3): void
        /* gdvirtual */ _hinge_joint_set_param(joint: RID, param: PhysicsServer3D.HingeJointParam, value: float64): void
        /* gdvirtual */ _hinge_joint_get_param(joint: RID, param: PhysicsServer3D.HingeJointParam): float64
        /* gdvirtual */ _hinge_joint_set_flag(joint: RID, flag: PhysicsServer3D.HingeJointFlag, enabled: boolean): void
        /* gdvirtual */ _hinge_joint_get_flag(joint: RID, flag: PhysicsServer3D.HingeJointFlag): boolean
        /* gdvirtual */ _joint_make_slider(joint: RID, body_A: RID, local_ref_A: Transform3D, body_B: RID, local_ref_B: Transform3D): void
        /* gdvirtual */ _slider_joint_set_param(joint: RID, param: PhysicsServer3D.SliderJointParam, value: float64): void
        /* gdvirtual */ _slider_joint_get_param(joint: RID, param: PhysicsServer3D.SliderJointParam): float64
        /* gdvirtual */ _joint_make_cone_twist(joint: RID, body_A: RID, local_ref_A: Transform3D, body_B: RID, local_ref_B: Transform3D): void
        /* gdvirtual */ _cone_twist_joint_set_param(joint: RID, param: PhysicsServer3D.ConeTwistJointParam, value: float64): void
        /* gdvirtual */ _cone_twist_joint_get_param(joint: RID, param: PhysicsServer3D.ConeTwistJointParam): float64
        /* gdvirtual */ _joint_make_generic_6dof(joint: RID, body_A: RID, local_ref_A: Transform3D, body_B: RID, local_ref_B: Transform3D): void
        /* gdvirtual */ _generic_6dof_joint_set_param(joint: RID, axis: Vector3.Axis, param: PhysicsServer3D.G6DOFJointAxisParam, value: float64): void
        /* gdvirtual */ _generic_6dof_joint_get_param(joint: RID, axis: Vector3.Axis, param: PhysicsServer3D.G6DOFJointAxisParam): float64
        /* gdvirtual */ _generic_6dof_joint_set_flag(joint: RID, axis: Vector3.Axis, flag: PhysicsServer3D.G6DOFJointAxisFlag, enable: boolean): void
        /* gdvirtual */ _generic_6dof_joint_get_flag(joint: RID, axis: Vector3.Axis, flag: PhysicsServer3D.G6DOFJointAxisFlag): boolean
        /* gdvirtual */ _joint_get_type(joint: RID): PhysicsServer3D.JointType
        /* gdvirtual */ _joint_set_solver_priority(joint: RID, priority: int64): void
        /* gdvirtual */ _joint_get_solver_priority(joint: RID): int64
        /* gdvirtual */ _joint_disable_collisions_between_bodies(joint: RID, disable: boolean): void
        /* gdvirtual */ _joint_is_disabled_collisions_between_bodies(joint: RID): boolean
        /* gdvirtual */ _free_rid(rid: RID): void
        /* gdvirtual */ _set_active(active: boolean): void
        /* gdvirtual */ _init(): void
        /* gdvirtual */ _step(step: float64): void
        /* gdvirtual */ _sync(): void
        /* gdvirtual */ _flush_queries(): void
        /* gdvirtual */ _end_sync(): void
        /* gdvirtual */ _finish(): void
        /* gdvirtual */ _is_flushing_queries(): boolean
        /* gdvirtual */ _get_process_info(process_info: PhysicsServer3D.ProcessInfo): int64
        body_test_motion_is_excluding_body(body: RID): boolean
        body_test_motion_is_excluding_object(object: int64): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapPhysicsServer3DExtension;
    }
}
