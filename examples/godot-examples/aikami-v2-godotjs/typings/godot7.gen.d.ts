// AUTO-GENERATED
declare module "godot" {
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DCCDIK extends __NameMapSkeletonModification2D {
    }
    /** A modification that uses CCDIK to manipulate a series of bones to reach a target in 2D.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2dccdik.html  
     */
    class SkeletonModification2DCCDIK extends SkeletonModification2D {
        constructor(identifier?: any)
        /** Sets the [Bone2D] node assigned to the CCDIK joint at [param joint_idx]. */
        set_ccdik_joint_bone2d_node(joint_idx: int64, bone2d_nodepath: NodePath | string): void
        
        /** Returns the [Bone2D] node assigned to the CCDIK joint at [param joint_idx]. */
        get_ccdik_joint_bone2d_node(joint_idx: int64): NodePath
        
        /** Sets the bone index, [param bone_idx], of the CCDIK joint at [param joint_idx]. When possible, this will also update the `bone2d_node` of the CCDIK joint based on data provided by the linked skeleton. */
        set_ccdik_joint_bone_index(joint_idx: int64, bone_idx: int64): void
        
        /** Returns the index of the [Bone2D] node assigned to the CCDIK joint at [param joint_idx]. */
        get_ccdik_joint_bone_index(joint_idx: int64): int64
        
        /** Sets whether the joint at [param joint_idx] is set to rotate from the joint, `true`, or to rotate from the tip, `false`. */
        set_ccdik_joint_rotate_from_joint(joint_idx: int64, rotate_from_joint: boolean): void
        
        /** Returns whether the joint at [param joint_idx] is set to rotate from the joint, `true`, or to rotate from the tip, `false`. The default is to rotate from the tip. */
        get_ccdik_joint_rotate_from_joint(joint_idx: int64): boolean
        
        /** Determines whether angle constraints on the CCDIK joint at [param joint_idx] are enabled. When `true`, constraints will be enabled and taken into account when solving. */
        set_ccdik_joint_enable_constraint(joint_idx: int64, enable_constraint: boolean): void
        
        /** Returns whether angle constraints on the CCDIK joint at [param joint_idx] are enabled. */
        get_ccdik_joint_enable_constraint(joint_idx: int64): boolean
        
        /** Sets the minimum angle constraint for the joint at [param joint_idx]. */
        set_ccdik_joint_constraint_angle_min(joint_idx: int64, angle_min: float64): void
        
        /** Returns the minimum angle constraint for the joint at [param joint_idx]. */
        get_ccdik_joint_constraint_angle_min(joint_idx: int64): float64
        
        /** Sets the maximum angle constraint for the joint at [param joint_idx]. */
        set_ccdik_joint_constraint_angle_max(joint_idx: int64, angle_max: float64): void
        
        /** Returns the maximum angle constraint for the joint at [param joint_idx]. */
        get_ccdik_joint_constraint_angle_max(joint_idx: int64): float64
        
        /** Sets whether the CCDIK joint at [param joint_idx] uses an inverted joint constraint.  
         *  An inverted joint constraint only constraints the CCDIK joint to the angles  *outside of*  the inputted minimum and maximum angles. For this reason, it is referred to as an inverted joint constraint, as it constraints the joint to the outside of the inputted values.  
         */
        set_ccdik_joint_constraint_angle_invert(joint_idx: int64, invert: boolean): void
        
        /** Returns whether the CCDIK joint at [param joint_idx] uses an inverted joint constraint. See [method set_ccdik_joint_constraint_angle_invert] for details. */
        get_ccdik_joint_constraint_angle_invert(joint_idx: int64): boolean
        
        /** The NodePath to the node that is the target for the CCDIK modification. This node is what the CCDIK chain will attempt to rotate the bone chain to. */
        get target_nodepath(): NodePath
        set target_nodepath(value: NodePath | string)
        
        /** The end position of the CCDIK chain. Typically, this should be a child of a [Bone2D] node attached to the final [Bone2D] in the CCDIK chain. */
        get tip_nodepath(): NodePath
        set tip_nodepath(value: NodePath | string)
        
        /** The number of CCDIK joints in the CCDIK modification. */
        get ccdik_data_chain_length(): int64
        set ccdik_data_chain_length(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DCCDIK;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DFABRIK extends __NameMapSkeletonModification2D {
    }
    /** A modification that uses FABRIK to manipulate a series of [Bone2D] nodes to reach a target.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2dfabrik.html  
     */
    class SkeletonModification2DFABRIK extends SkeletonModification2D {
        constructor(identifier?: any)
        /** Sets the [Bone2D] node assigned to the FABRIK joint at [param joint_idx]. */
        set_fabrik_joint_bone2d_node(joint_idx: int64, bone2d_nodepath: NodePath | string): void
        
        /** Returns the [Bone2D] node assigned to the FABRIK joint at [param joint_idx]. */
        get_fabrik_joint_bone2d_node(joint_idx: int64): NodePath
        
        /** Sets the bone index, [param bone_idx], of the FABRIK joint at [param joint_idx]. When possible, this will also update the `bone2d_node` of the FABRIK joint based on data provided by the linked skeleton. */
        set_fabrik_joint_bone_index(joint_idx: int64, bone_idx: int64): void
        
        /** Returns the index of the [Bone2D] node assigned to the FABRIK joint at [param joint_idx]. */
        get_fabrik_joint_bone_index(joint_idx: int64): int64
        
        /** Sets the magnet position vector for the joint at [param joint_idx]. */
        set_fabrik_joint_magnet_position(joint_idx: int64, magnet_position: Vector2): void
        
        /** Returns the magnet position vector for the joint at [param joint_idx]. */
        get_fabrik_joint_magnet_position(joint_idx: int64): Vector2
        
        /** Sets whether the joint at [param joint_idx] will use the target node's rotation rather than letting FABRIK rotate the node.  
         *      
         *  **Note:** This option only works for the tip/final joint in the chain. For all other nodes, this option will be ignored.  
         */
        set_fabrik_joint_use_target_rotation(joint_idx: int64, use_target_rotation: boolean): void
        
        /** Returns whether the joint is using the target's rotation rather than allowing FABRIK to rotate the joint. This option only applies to the tip/final joint in the chain. */
        get_fabrik_joint_use_target_rotation(joint_idx: int64): boolean
        
        /** The NodePath to the node that is the target for the FABRIK modification. This node is what the FABRIK chain will attempt to rotate the bone chain to. */
        get target_nodepath(): NodePath
        set target_nodepath(value: NodePath | string)
        
        /** The number of FABRIK joints in the FABRIK modification. */
        get fabrik_data_chain_length(): int64
        set fabrik_data_chain_length(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DFABRIK;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DJiggle extends __NameMapSkeletonModification2D {
    }
    /** A modification that jiggles [Bone2D] nodes as they move towards a target.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2djiggle.html  
     */
    class SkeletonModification2DJiggle extends SkeletonModification2D {
        constructor(identifier?: any)
        /** If `true`, the Jiggle modifier will take colliders into account, keeping them from entering into these collision objects. */
        set_use_colliders(use_colliders: boolean): void
        
        /** Returns whether the jiggle modifier is taking physics colliders into account when solving. */
        get_use_colliders(): boolean
        
        /** Sets the collision mask that the Jiggle modifier will use when reacting to colliders, if the Jiggle modifier is set to take colliders into account. */
        set_collision_mask(collision_mask: int64): void
        
        /** Returns the collision mask used by the Jiggle modifier when collisions are enabled. */
        get_collision_mask(): int64
        
        /** Sets the [Bone2D] node assigned to the Jiggle joint at [param joint_idx]. */
        set_jiggle_joint_bone2d_node(joint_idx: int64, bone2d_node: NodePath | string): void
        
        /** Returns the [Bone2D] node assigned to the Jiggle joint at [param joint_idx]. */
        get_jiggle_joint_bone2d_node(joint_idx: int64): NodePath
        
        /** Sets the bone index, [param bone_idx], of the Jiggle joint at [param joint_idx]. When possible, this will also update the `bone2d_node` of the Jiggle joint based on data provided by the linked skeleton. */
        set_jiggle_joint_bone_index(joint_idx: int64, bone_idx: int64): void
        
        /** Returns the index of the [Bone2D] node assigned to the Jiggle joint at [param joint_idx]. */
        get_jiggle_joint_bone_index(joint_idx: int64): int64
        
        /** Sets whether the Jiggle joint at [param joint_idx] should override the default Jiggle joint settings. Setting this to `true` will make the joint use its own settings rather than the default ones attached to the modification. */
        set_jiggle_joint_override(joint_idx: int64, override: boolean): void
        
        /** Returns a boolean that indicates whether the joint at [param joint_idx] is overriding the default Jiggle joint data defined in the modification. */
        get_jiggle_joint_override(joint_idx: int64): boolean
        
        /** Sets the of stiffness of the Jiggle joint at [param joint_idx]. */
        set_jiggle_joint_stiffness(joint_idx: int64, stiffness: float64): void
        
        /** Returns the stiffness of the Jiggle joint at [param joint_idx]. */
        get_jiggle_joint_stiffness(joint_idx: int64): float64
        
        /** Sets the of mass of the Jiggle joint at [param joint_idx]. */
        set_jiggle_joint_mass(joint_idx: int64, mass: float64): void
        
        /** Returns the amount of mass of the jiggle joint at [param joint_idx]. */
        get_jiggle_joint_mass(joint_idx: int64): float64
        
        /** Sets the amount of damping of the Jiggle joint at [param joint_idx]. */
        set_jiggle_joint_damping(joint_idx: int64, damping: float64): void
        
        /** Returns the amount of damping of the Jiggle joint at [param joint_idx]. */
        get_jiggle_joint_damping(joint_idx: int64): float64
        
        /** Sets whether the Jiggle joint at [param joint_idx] should use gravity. */
        set_jiggle_joint_use_gravity(joint_idx: int64, use_gravity: boolean): void
        
        /** Returns a boolean that indicates whether the joint at [param joint_idx] is using gravity or not. */
        get_jiggle_joint_use_gravity(joint_idx: int64): boolean
        
        /** Sets the gravity vector of the Jiggle joint at [param joint_idx]. */
        set_jiggle_joint_gravity(joint_idx: int64, gravity: Vector2): void
        
        /** Returns a [Vector2] representing the amount of gravity the Jiggle joint at [param joint_idx] is influenced by. */
        get_jiggle_joint_gravity(joint_idx: int64): Vector2
        
        /** The NodePath to the node that is the target for the Jiggle modification. This node is what the Jiggle chain will attempt to rotate the bone chain to. */
        get target_nodepath(): NodePath
        set target_nodepath(value: NodePath | string)
        
        /** The amount of Jiggle joints in the Jiggle modification. */
        get jiggle_data_chain_length(): int64
        set jiggle_data_chain_length(value: int64)
        
        /** The default amount of stiffness assigned to the Jiggle joints, if they are not overridden. Higher values act more like springs, quickly moving into the correct position. */
        get stiffness(): float64
        set stiffness(value: float64)
        
        /** The default amount of mass assigned to the Jiggle joints, if they are not overridden. Higher values lead to faster movements and more overshooting. */
        get mass(): float64
        set mass(value: float64)
        
        /** The default amount of damping applied to the Jiggle joints, if they are not overridden. Higher values lead to more of the calculated velocity being applied. */
        get damping(): float64
        set damping(value: float64)
        
        /** Whether the gravity vector, [member gravity], should be applied to the Jiggle joints, assuming they are not overriding the default settings. */
        get use_gravity(): boolean
        set use_gravity(value: boolean)
        
        /** The default amount of gravity applied to the Jiggle joints, if they are not overridden. */
        get gravity(): Vector2
        set gravity(value: Vector2)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DJiggle;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DLookAt extends __NameMapSkeletonModification2D {
    }
    /** A modification that rotates a [Bone2D] node to look at a target.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2dlookat.html  
     */
    class SkeletonModification2DLookAt extends SkeletonModification2D {
        constructor(identifier?: any)
        /** Sets the amount of additional rotation that is to be applied after executing the modification. This allows for offsetting the results by the inputted rotation amount. */
        set_additional_rotation(rotation: float64): void
        
        /** Returns the amount of additional rotation that is applied after the LookAt modification executes. */
        get_additional_rotation(): float64
        
        /** Sets whether this modification will use constraints or not. When `true`, constraints will be applied when solving the LookAt modification. */
        set_enable_constraint(enable_constraint: boolean): void
        
        /** Returns `true` if the LookAt modification is using constraints. */
        get_enable_constraint(): boolean
        
        /** Sets the constraint's minimum allowed angle. */
        set_constraint_angle_min(angle_min: float64): void
        
        /** Returns the constraint's minimum allowed angle. */
        get_constraint_angle_min(): float64
        
        /** Sets the constraint's maximum allowed angle. */
        set_constraint_angle_max(angle_max: float64): void
        
        /** Returns the constraint's maximum allowed angle. */
        get_constraint_angle_max(): float64
        
        /** When `true`, the modification will use an inverted joint constraint.  
         *  An inverted joint constraint only constraints the [Bone2D] to the angles  *outside of*  the inputted minimum and maximum angles. For this reason, it is referred to as an inverted joint constraint, as it constraints the joint to the outside of the inputted values.  
         */
        set_constraint_angle_invert(invert: boolean): void
        
        /** Returns whether the constraints to this modification are inverted or not. */
        get_constraint_angle_invert(): boolean
        
        /** The index of the [Bone2D] node that the modification will operate on. */
        get bone_index(): int64
        set bone_index(value: int64)
        
        /** The [Bone2D] node that the modification will operate on. */
        get bone2d_node(): NodePath
        set bone2d_node(value: NodePath | string)
        
        /** The NodePath to the node that is the target for the LookAt modification. This node is what the modification will rotate the [Bone2D] to. */
        get target_nodepath(): NodePath
        set target_nodepath(value: NodePath | string)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DLookAt;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DPhysicalBones extends __NameMapSkeletonModification2D {
    }
    /** A modification that applies the transforms of [PhysicalBone2D] nodes to [Bone2D] nodes.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2dphysicalbones.html  
     */
    class SkeletonModification2DPhysicalBones extends SkeletonModification2D {
        constructor(identifier?: any)
        /** Sets the [PhysicalBone2D] node at [param joint_idx].  
         *      
         *  **Note:** This is just the index used for this modification, not the bone index used in the [Skeleton2D].  
         */
        set_physical_bone_node(joint_idx: int64, physicalbone2d_node: NodePath | string): void
        
        /** Returns the [PhysicalBone2D] node at [param joint_idx]. */
        get_physical_bone_node(joint_idx: int64): NodePath
        
        /** Empties the list of [PhysicalBone2D] nodes and populates it with all [PhysicalBone2D] nodes that are children of the [Skeleton2D]. */
        fetch_physical_bones(): void
        
        /** Tell the [PhysicalBone2D] nodes to start simulating and interacting with the physics world.  
         *  Optionally, an array of bone names can be passed to this function, and that will cause only [PhysicalBone2D] nodes with those names to start simulating.  
         */
        start_simulation(bones?: GArray<StringName>): void
        
        /** Tell the [PhysicalBone2D] nodes to stop simulating and interacting with the physics world.  
         *  Optionally, an array of bone names can be passed to this function, and that will cause only [PhysicalBone2D] nodes with those names to stop simulating.  
         */
        stop_simulation(bones?: GArray<StringName>): void
        
        /** The number of [PhysicalBone2D] nodes linked in this modification. */
        get physical_bone_chain_length(): int64
        set physical_bone_chain_length(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DPhysicalBones;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DStackHolder extends __NameMapSkeletonModification2D {
    }
    /** A modification that holds and executes a [SkeletonModificationStack2D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2dstackholder.html  
     */
    class SkeletonModification2DStackHolder extends SkeletonModification2D {
        constructor(identifier?: any)
        /** Sets the [SkeletonModificationStack2D] that this modification is holding. This modification stack will then be executed when this modification is executed. */
        set_held_modification_stack(held_modification_stack: SkeletonModificationStack2D): void
        
        /** Returns the [SkeletonModificationStack2D] that this modification is holding. */
        get_held_modification_stack(): null | SkeletonModificationStack2D
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DStackHolder;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModification2DTwoBoneIK extends __NameMapSkeletonModification2D {
    }
    /** A modification that rotates two bones using the law of cosines to reach the target.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodification2dtwoboneik.html  
     */
    class SkeletonModification2DTwoBoneIK extends SkeletonModification2D {
        constructor(identifier?: any)
        /** Sets the [Bone2D] node that is being used as the first bone in the TwoBoneIK modification. */
        set_joint_one_bone2d_node(bone2d_node: NodePath | string): void
        
        /** Returns the [Bone2D] node that is being used as the first bone in the TwoBoneIK modification. */
        get_joint_one_bone2d_node(): NodePath
        
        /** Sets the index of the [Bone2D] node that is being used as the first bone in the TwoBoneIK modification. */
        set_joint_one_bone_idx(bone_idx: int64): void
        
        /** Returns the index of the [Bone2D] node that is being used as the first bone in the TwoBoneIK modification. */
        get_joint_one_bone_idx(): int64
        
        /** Sets the [Bone2D] node that is being used as the second bone in the TwoBoneIK modification. */
        set_joint_two_bone2d_node(bone2d_node: NodePath | string): void
        
        /** Returns the [Bone2D] node that is being used as the second bone in the TwoBoneIK modification. */
        get_joint_two_bone2d_node(): NodePath
        
        /** Sets the index of the [Bone2D] node that is being used as the second bone in the TwoBoneIK modification. */
        set_joint_two_bone_idx(bone_idx: int64): void
        
        /** Returns the index of the [Bone2D] node that is being used as the second bone in the TwoBoneIK modification. */
        get_joint_two_bone_idx(): int64
        
        /** The NodePath to the node that is the target for the TwoBoneIK modification. This node is what the modification will use when bending the [Bone2D] nodes. */
        get target_nodepath(): NodePath
        set target_nodepath(value: NodePath | string)
        
        /** The minimum distance the target can be at. If the target is closer than this distance, the modification will solve as if it's at this minimum distance. When set to `0`, the modification will solve without distance constraints. */
        get target_minimum_distance(): float64
        set target_minimum_distance(value: float64)
        
        /** The maximum distance the target can be at. If the target is farther than this distance, the modification will solve as if it's at this maximum distance. When set to `0`, the modification will solve without distance constraints. */
        get target_maximum_distance(): float64
        set target_maximum_distance(value: float64)
        
        /** If `true`, the bones in the modification will bend outward as opposed to inwards when contracting. If `false`, the bones will bend inwards when contracting. */
        get flip_bend_direction(): boolean
        set flip_bend_direction(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModification2DTwoBoneIK;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModificationStack2D extends __NameMapResource {
    }
    /** A resource that holds a stack of [SkeletonModification2D]s.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodificationstack2d.html  
     */
    class SkeletonModificationStack2D extends Resource {
        constructor(identifier?: any)
        /** Sets up the modification stack so it can execute. This function should be called by [Skeleton2D] and shouldn't be manually called unless you know what you are doing. */
        setup(): void
        
        /** Executes all of the [SkeletonModification2D]s in the stack that use the same execution mode as the passed-in [param execution_mode], starting from index `0` to [member modification_count].  
         *      
         *  **Note:** The order of the modifications can matter depending on the modifications. For example, modifications on a spine should operate before modifications on the arms in order to get proper results.  
         */
        execute(delta: float64, execution_mode: int64): void
        
        /** Enables all [SkeletonModification2D]s in the stack. */
        enable_all_modifications(enabled: boolean): void
        
        /** Returns the [SkeletonModification2D] at the passed-in index, [param mod_idx]. */
        get_modification(mod_idx: int64): null | SkeletonModification2D
        
        /** Adds the passed-in [SkeletonModification2D] to the stack. */
        add_modification(modification: SkeletonModification2D): void
        
        /** Deletes the [SkeletonModification2D] at the index position [param mod_idx], if it exists. */
        delete_modification(mod_idx: int64): void
        
        /** Sets the modification at [param mod_idx] to the passed-in modification, [param modification]. */
        set_modification(mod_idx: int64, modification: SkeletonModification2D): void
        
        /** Returns a boolean that indicates whether the modification stack is setup and can execute. */
        get_is_setup(): boolean
        
        /** Returns the [Skeleton2D] node that the SkeletonModificationStack2D is bound to. */
        get_skeleton(): null | Skeleton2D
        
        /** If `true`, the modification's in the stack will be called. This is handled automatically through the [Skeleton2D] node. */
        get enabled(): boolean
        set enabled(value: boolean)
        
        /** The interpolation strength of the modifications in stack. A value of `0` will make it where the modifications are not applied, a strength of `0.5` will be half applied, and a strength of `1` will allow the modifications to be fully applied and override the [Skeleton2D] [Bone2D] poses. */
        get strength(): float64
        set strength(value: float64)
        
        /** The number of modifications in the stack. */
        get modification_count(): int64
        set modification_count(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModificationStack2D;
    }
    namespace SkeletonModifier3D {
        enum BoneAxis {
            /** Enumerated value for the +X axis. */
            BONE_AXIS_PLUS_X = 0,
            
            /** Enumerated value for the -X axis. */
            BONE_AXIS_MINUS_X = 1,
            
            /** Enumerated value for the +Y axis. */
            BONE_AXIS_PLUS_Y = 2,
            
            /** Enumerated value for the -Y axis. */
            BONE_AXIS_MINUS_Y = 3,
            
            /** Enumerated value for the +Z axis. */
            BONE_AXIS_PLUS_Z = 4,
            
            /** Enumerated value for the -Z axis. */
            BONE_AXIS_MINUS_Z = 5,
        }
        enum BoneDirection {
            /** Enumerated value for the +X axis. */
            BONE_DIRECTION_PLUS_X = 0,
            
            /** Enumerated value for the -X axis. */
            BONE_DIRECTION_MINUS_X = 1,
            
            /** Enumerated value for the +Y axis. */
            BONE_DIRECTION_PLUS_Y = 2,
            
            /** Enumerated value for the -Y axis. */
            BONE_DIRECTION_MINUS_Y = 3,
            
            /** Enumerated value for the +Z axis. */
            BONE_DIRECTION_PLUS_Z = 4,
            
            /** Enumerated value for the -Z axis. */
            BONE_DIRECTION_MINUS_Z = 5,
            
            /** Enumerated value for the axis from a parent bone to the child bone. */
            BONE_DIRECTION_FROM_PARENT = 6,
        }
        enum SecondaryDirection {
            /** Enumerated value for the case when the axis is undefined. */
            SECONDARY_DIRECTION_NONE = 0,
            
            /** Enumerated value for the +X axis. */
            SECONDARY_DIRECTION_PLUS_X = 1,
            
            /** Enumerated value for the -X axis. */
            SECONDARY_DIRECTION_MINUS_X = 2,
            
            /** Enumerated value for the +Y axis. */
            SECONDARY_DIRECTION_PLUS_Y = 3,
            
            /** Enumerated value for the -Y axis. */
            SECONDARY_DIRECTION_MINUS_Y = 4,
            
            /** Enumerated value for the +Z axis. */
            SECONDARY_DIRECTION_PLUS_Z = 5,
            
            /** Enumerated value for the -Z axis. */
            SECONDARY_DIRECTION_MINUS_Z = 6,
            
            /** Enumerated value for an optional axis. */
            SECONDARY_DIRECTION_CUSTOM = 7,
        }
        enum RotationAxis {
            /** Enumerated value for the rotation of the X axis. */
            ROTATION_AXIS_X = 0,
            
            /** Enumerated value for the rotation of the Y axis. */
            ROTATION_AXIS_Y = 1,
            
            /** Enumerated value for the rotation of the Z axis. */
            ROTATION_AXIS_Z = 2,
            
            /** Enumerated value for the unconstrained rotation. */
            ROTATION_AXIS_ALL = 3,
            
            /** Enumerated value for an optional rotation axis. */
            ROTATION_AXIS_CUSTOM = 4,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonModifier3D extends __NameMapNode3D {
    }
    /** A node that may modify a Skeleton3D's bones.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonmodifier3d.html  
     */
    class SkeletonModifier3D<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Override this virtual method to implement a custom skeleton modifier. You should do things like get the [Skeleton3D]'s current pose and apply the pose here.  
         *  [method _process_modification_with_delta] must not apply [member influence] to bone poses because the [Skeleton3D] automatically applies influence to all bone poses set by the modifier.  
         *  [param delta] is passed from parent [Skeleton3D]. See also [method Skeleton3D.advance].  
         *      
         *  **Note:** This method may be called outside [method Node._process] and [method Node._physics_process] with [param delta] is `0.0`, since the modification should be processed immediately after initialization of the [Skeleton3D].  
         */
        /* gdvirtual */ _process_modification_with_delta(delta: float64): void
        
        /** Override this virtual method to implement a custom skeleton modifier. You should do things like get the [Skeleton3D]'s current pose and apply the pose here.  
         *  [method _process_modification] must not apply [member influence] to bone poses because the [Skeleton3D] automatically applies influence to all bone poses set by the modifier.  
         */
        /* gdvirtual */ _process_modification(): void
        
        /** Called when the skeleton is changed. */
        /* gdvirtual */ _skeleton_changed(old_skeleton: Skeleton3D, new_skeleton: Skeleton3D): void
        
        /** Called when bone names and indices need to be validated, such as when entering the scene tree or changing skeleton. */
        /* gdvirtual */ _validate_bone_names(): void
        
        /** Returns the parent [Skeleton3D] node if it exists. Otherwise, returns `null`. */
        get_skeleton(): null | Skeleton3D
        
        /** If `true`, the [SkeletonModifier3D] will be processing. */
        get active(): boolean
        set active(value: boolean)
        
        /** Sets the influence of the modification.  
         *      
         *  **Note:** This value is used by [Skeleton3D] to blend, so the [SkeletonModifier3D] should always apply only 100% of the result without interpolation.  
         */
        get influence(): float64
        set influence(value: float64)
        
        /** Notifies when the modification have been finished.  
         *      
         *  **Note:** If you want to get the modified bone pose by the modifier, you must use [method Skeleton3D.get_bone_pose] or [method Skeleton3D.get_bone_global_pose] at the moment this signal is fired.  
         */
        readonly modification_processed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonModifier3D;
    }
    namespace SkeletonProfile {
        enum TailDirection {
            /** Direction to the average coordinates of bone children. */
            TAIL_DIRECTION_AVERAGE_CHILDREN = 0,
            
            /** Direction to the coordinates of specified bone child. */
            TAIL_DIRECTION_SPECIFIC_CHILD = 1,
            
            /** Direction is not calculated. */
            TAIL_DIRECTION_END = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonProfile extends __NameMapResource {
    }
    /** Base class for a profile of a virtual skeleton used as a target for retargeting.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonprofile.html  
     */
    class SkeletonProfile extends Resource {
        constructor(identifier?: any)
        /** Returns the name of the group at [param group_idx] that will be the drawing group in the [BoneMap] editor. */
        get_group_name(group_idx: int64): StringName
        
        /** Sets the name of the group at [param group_idx] that will be the drawing group in the [BoneMap] editor. */
        set_group_name(group_idx: int64, group_name: StringName): void
        
        /** Returns the texture of the group at [param group_idx] that will be the drawing group background image in the [BoneMap] editor. */
        get_texture(group_idx: int64): null | Texture2D
        
        /** Sets the texture of the group at [param group_idx] that will be the drawing group background image in the [BoneMap] editor. */
        set_texture(group_idx: int64, texture: Texture2D): void
        
        /** Returns the bone index that matches [param bone_name] as its name. */
        find_bone(bone_name: StringName): int64
        
        /** Returns the name of the bone at [param bone_idx] that will be the key name in the [BoneMap].  
         *  In the retargeting process, the returned bone name is the bone name of the target skeleton.  
         */
        get_bone_name(bone_idx: int64): StringName
        
        /** Sets the name of the bone at [param bone_idx] that will be the key name in the [BoneMap].  
         *  In the retargeting process, the setting bone name is the bone name of the target skeleton.  
         */
        set_bone_name(bone_idx: int64, bone_name: StringName): void
        
        /** Returns the name of the bone which is the parent to the bone at [param bone_idx]. The result is empty if the bone has no parent. */
        get_bone_parent(bone_idx: int64): StringName
        
        /** Sets the bone with name [param bone_parent] as the parent of the bone at [param bone_idx]. If an empty string is passed, then the bone has no parent. */
        set_bone_parent(bone_idx: int64, bone_parent: StringName): void
        
        /** Returns the tail direction of the bone at [param bone_idx]. */
        get_tail_direction(bone_idx: int64): SkeletonProfile.TailDirection
        
        /** Sets the tail direction of the bone at [param bone_idx].  
         *      
         *  **Note:** This only specifies the method of calculation. The actual coordinates required should be stored in an external skeleton, so the calculation itself needs to be done externally.  
         */
        set_tail_direction(bone_idx: int64, tail_direction: SkeletonProfile.TailDirection): void
        
        /** Returns the name of the bone which is the tail of the bone at [param bone_idx]. */
        get_bone_tail(bone_idx: int64): StringName
        
        /** Sets the bone with name [param bone_tail] as the tail of the bone at [param bone_idx]. */
        set_bone_tail(bone_idx: int64, bone_tail: StringName): void
        
        /** Returns the reference pose transform for bone [param bone_idx]. */
        get_reference_pose(bone_idx: int64): Transform3D
        
        /** Sets the reference pose transform for bone [param bone_idx]. */
        set_reference_pose(bone_idx: int64, bone_name: Transform3D): void
        
        /** Returns the offset of the bone at [param bone_idx] that will be the button position in the [BoneMap] editor.  
         *  This is the offset with origin at the top left corner of the square.  
         */
        get_handle_offset(bone_idx: int64): Vector2
        
        /** Sets the offset of the bone at [param bone_idx] that will be the button position in the [BoneMap] editor.  
         *  This is the offset with origin at the top left corner of the square.  
         */
        set_handle_offset(bone_idx: int64, handle_offset: Vector2): void
        
        /** Returns the group of the bone at [param bone_idx]. */
        get_group(bone_idx: int64): StringName
        
        /** Sets the group of the bone at [param bone_idx]. */
        set_group(bone_idx: int64, group: StringName): void
        
        /** Returns whether the bone at [param bone_idx] is required for retargeting.  
         *  This value is used by the bone map editor. If this method returns `true`, and no bone is assigned, the handle color will be red on the bone map editor.  
         */
        is_required(bone_idx: int64): boolean
        
        /** Sets the required status for bone [param bone_idx] to [param required]. */
        set_required(bone_idx: int64, required: boolean): void
        
        /** A bone name that will be used as the root bone in [AnimationTree]. This should be the bone of the parent of hips that exists at the world origin. */
        get root_bone(): StringName
        set root_bone(value: StringName)
        
        /** A bone name which will use model's height as the coefficient for normalization. For example, [SkeletonProfileHumanoid] defines it as `Hips`. */
        get scale_base_bone(): StringName
        set scale_base_bone(value: StringName)
        
        /** The amount of groups of bones in retargeting section's [BoneMap] editor. For example, [SkeletonProfileHumanoid] has 4 groups.  
         *  This property exists to separate the bone list into several sections in the editor.  
         */
        get group_size(): int64
        set group_size(value: int64)
        
        /** The amount of bones in retargeting section's [BoneMap] editor. For example, [SkeletonProfileHumanoid] has 56 bones.  
         *  The size of elements in [BoneMap] updates when changing this property in it's assigned [SkeletonProfile].  
         */
        get bone_size(): int64
        set bone_size(value: int64)
        
        /** This signal is emitted when change the value in profile. This is used to update key name in the [BoneMap] and to redraw the [BoneMap] editor.  
         *      
         *  **Note:** This signal is not connected directly to editor to simplify the reference, instead it is passed on to editor through the [BoneMap].  
         */
        readonly profile_updated: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonProfile;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkeletonProfileHumanoid extends __NameMapSkeletonProfile {
    }
    /** A humanoid [SkeletonProfile] preset.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skeletonprofilehumanoid.html  
     */
    class SkeletonProfileHumanoid extends SkeletonProfile {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkeletonProfileHumanoid;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkin extends __NameMapResource {
    }
    /** @link https://docs.godotengine.org/en/4.6/classes/class_skin.html */
    class Skin extends Resource {
        constructor(identifier?: any)
        set_bind_count(bind_count: int64): void
        get_bind_count(): int64
        add_bind(bone: int64, pose: Transform3D): void
        add_named_bind(name: string, pose: Transform3D): void
        set_bind_pose(bind_index: int64, pose: Transform3D): void
        get_bind_pose(bind_index: int64): Transform3D
        set_bind_name(bind_index: int64, name: StringName): void
        get_bind_name(bind_index: int64): StringName
        set_bind_bone(bind_index: int64, bone: int64): void
        get_bind_bone(bind_index: int64): int64
        clear_binds(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkin;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSkinReference extends __NameMapRefCounted {
    }
    /** A reference-counted holder object for a skeleton RID used in the [RenderingServer].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_skinreference.html  
     */
    class SkinReference extends RefCounted {
        constructor(identifier?: any)
        /** Returns the [RID] owned by this SkinReference, as returned by [method RenderingServer.skeleton_create]. */
        get_skeleton(): RID
        
        /** Returns the [Skin] connected to this SkinReference. In the case of [MeshInstance3D] with no [member MeshInstance3D.skin] assigned, this will reference an internal default [Skin] owned by that [MeshInstance3D].  
         *  Note that a single [Skin] may have more than one [SkinReference] in the case that it is shared by meshes across multiple [Skeleton3D] nodes.  
         */
        get_skin(): null | Skin
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSkinReference;
    }
    namespace Sky {
        enum RadianceSize {
            /** Radiance texture size is 32×32 pixels. */
            RADIANCE_SIZE_32 = 0,
            
            /** Radiance texture size is 64×64 pixels. */
            RADIANCE_SIZE_64 = 1,
            
            /** Radiance texture size is 128×128 pixels. */
            RADIANCE_SIZE_128 = 2,
            
            /** Radiance texture size is 256×256 pixels. */
            RADIANCE_SIZE_256 = 3,
            
            /** Radiance texture size is 512×512 pixels. */
            RADIANCE_SIZE_512 = 4,
            
            /** Radiance texture size is 1024×1024 pixels. */
            RADIANCE_SIZE_1024 = 5,
            
            /** Radiance texture size is 2048×2048 pixels. */
            RADIANCE_SIZE_2048 = 6,
            
            /** Represents the size of the [enum RadianceSize] enum. */
            RADIANCE_SIZE_MAX = 7,
        }
        enum ProcessMode {
            /** Automatically selects the appropriate process mode based on your sky shader. If your shader uses `TIME` or `POSITION`, this will use [constant PROCESS_MODE_REALTIME]. If your shader uses any of the `LIGHT_*` variables or any custom uniforms, this uses [constant PROCESS_MODE_INCREMENTAL]. Otherwise, this defaults to [constant PROCESS_MODE_QUALITY]. */
            PROCESS_MODE_AUTOMATIC = 0,
            
            /** Uses high quality importance sampling to process the radiance map. In general, this results in much higher quality than [constant PROCESS_MODE_REALTIME] but takes much longer to generate. This should not be used if you plan on changing the sky at runtime. If you are finding that the reflection is not blurry enough and is showing sparkles or fireflies, try increasing [member ProjectSettings.rendering/reflections/sky_reflections/ggx_samples]. */
            PROCESS_MODE_QUALITY = 1,
            
            /** Uses the same high quality importance sampling to process the radiance map as [constant PROCESS_MODE_QUALITY], but updates over several frames. The number of frames is determined by [member ProjectSettings.rendering/reflections/sky_reflections/roughness_layers]. Use this when you need highest quality radiance maps, but have a sky that updates slowly. */
            PROCESS_MODE_INCREMENTAL = 2,
            
            /** Uses the fast filtering algorithm to process the radiance map. In general this results in lower quality, but substantially faster run times. If you need better quality, but still need to update the sky every frame, consider turning on [member ProjectSettings.rendering/reflections/sky_reflections/fast_filter_high_quality].  
             *      
             *  **Note:** The fast filtering algorithm is limited to 256×256 cubemaps, so [member radiance_size] must be set to [constant RADIANCE_SIZE_256]. Otherwise, a warning is printed and the overridden radiance size is ignored.  
             */
            PROCESS_MODE_REALTIME = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSky extends __NameMapResource {
    }
    /** Defines a 3D environment's background by using a [Material].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_sky.html  
     */
    class Sky extends Resource {
        constructor(identifier?: any)
        /** [Material] used to draw the background. Can be [PanoramaSkyMaterial], [ProceduralSkyMaterial], [PhysicalSkyMaterial], or even a [ShaderMaterial] if you want to use your own custom shader. */
        get sky_material(): null | PanoramaSkyMaterial | ProceduralSkyMaterial | PhysicalSkyMaterial | ShaderMaterial
        set sky_material(value: null | PanoramaSkyMaterial | ProceduralSkyMaterial | PhysicalSkyMaterial | ShaderMaterial)
        
        /** The method for generating the radiance map from the sky. The radiance map is a cubemap with increasingly blurry versions of the sky corresponding to different levels of roughness. Radiance maps can be expensive to calculate. */
        get process_mode(): int64
        set process_mode(value: int64)
        
        /** The [Sky]'s radiance map size. The higher the radiance map size, the more detailed the lighting from the [Sky] will be.  
         *      
         *  **Note:** Some hardware will have trouble with higher radiance sizes, especially [constant RADIANCE_SIZE_512] and above. Only use such high values on high-end hardware.  
         */
        get radiance_size(): int64
        set radiance_size(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSky;
    }
    namespace Slider {
        enum TickPosition {
            /** Places the ticks at the bottom of the [HSlider], or right of the [VSlider]. */
            TICK_POSITION_BOTTOM_RIGHT = 0,
            
            /** Places the ticks at the top of the [HSlider], or left of the [VSlider]. */
            TICK_POSITION_TOP_LEFT = 1,
            
            /** Places the ticks at the both sides of the slider. */
            TICK_POSITION_BOTH = 2,
            
            /** Places the ticks at the center of the slider. */
            TICK_POSITION_CENTER = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSlider extends __NameMapRange {
    }
    /** Abstract base class for sliders.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_slider.html  
     */
    class Slider<Map extends NodePathMap = any> extends Range<Map> {
        constructor(identifier?: any)
        /** If `true`, the slider can be interacted with. If `false`, the value can be changed only by code. */
        get editable(): boolean
        set editable(value: boolean)
        
        /** If `true`, the value can be changed using the mouse wheel. */
        get scrollable(): boolean
        set scrollable(value: boolean)
        
        /** Number of ticks displayed on the slider, including border ticks. Ticks are uniformly-distributed value markers. */
        get tick_count(): int64
        set tick_count(value: int64)
        
        /** If `true`, the slider will display ticks for minimum and maximum values. */
        get ticks_on_borders(): boolean
        set ticks_on_borders(value: boolean)
        
        /** Sets the position of the ticks. See [enum TickPosition] for details. */
        get ticks_position(): int64
        set ticks_position(value: int64)
        
        /** Emitted when the grabber starts being dragged. This is emitted before the corresponding [signal Range.value_changed] signal. */
        readonly drag_started: Signal<() => void>
        
        /** Emitted when the grabber stops being dragged. If [param value_changed] is `true`, [member Range.value] is different from the value when the dragging was started. */
        readonly drag_ended: Signal<(value_changed: boolean) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSlider;
    }
    namespace SliderJoint3D {
        enum Param {
            /** Constant for accessing [member linear_limit/upper_distance]. The maximum difference between the pivot points on their X axis before damping happens. */
            PARAM_LINEAR_LIMIT_UPPER = 0,
            
            /** Constant for accessing [member linear_limit/lower_distance]. The minimum difference between the pivot points on their X axis before damping happens. */
            PARAM_LINEAR_LIMIT_LOWER = 1,
            
            /** Constant for accessing [member linear_limit/softness]. A factor applied to the movement across the slider axis once the limits get surpassed. The lower, the slower the movement. */
            PARAM_LINEAR_LIMIT_SOFTNESS = 2,
            
            /** Constant for accessing [member linear_limit/restitution]. The amount of restitution once the limits are surpassed. The lower, the more velocity-energy gets lost. */
            PARAM_LINEAR_LIMIT_RESTITUTION = 3,
            
            /** Constant for accessing [member linear_limit/damping]. The amount of damping once the slider limits are surpassed. */
            PARAM_LINEAR_LIMIT_DAMPING = 4,
            
            /** Constant for accessing [member linear_motion/softness]. A factor applied to the movement across the slider axis as long as the slider is in the limits. The lower, the slower the movement. */
            PARAM_LINEAR_MOTION_SOFTNESS = 5,
            
            /** Constant for accessing [member linear_motion/restitution]. The amount of restitution inside the slider limits. */
            PARAM_LINEAR_MOTION_RESTITUTION = 6,
            
            /** Constant for accessing [member linear_motion/damping]. The amount of damping inside the slider limits. */
            PARAM_LINEAR_MOTION_DAMPING = 7,
            
            /** Constant for accessing [member linear_ortho/softness]. A factor applied to the movement across axes orthogonal to the slider. */
            PARAM_LINEAR_ORTHOGONAL_SOFTNESS = 8,
            
            /** Constant for accessing [member linear_motion/restitution]. The amount of restitution when movement is across axes orthogonal to the slider. */
            PARAM_LINEAR_ORTHOGONAL_RESTITUTION = 9,
            
            /** Constant for accessing [member linear_motion/damping]. The amount of damping when movement is across axes orthogonal to the slider. */
            PARAM_LINEAR_ORTHOGONAL_DAMPING = 10,
            
            /** Constant for accessing [member angular_limit/upper_angle]. The upper limit of rotation in the slider. */
            PARAM_ANGULAR_LIMIT_UPPER = 11,
            
            /** Constant for accessing [member angular_limit/lower_angle]. The lower limit of rotation in the slider. */
            PARAM_ANGULAR_LIMIT_LOWER = 12,
            
            /** Constant for accessing [member angular_limit/softness]. A factor applied to the all rotation once the limit is surpassed. */
            PARAM_ANGULAR_LIMIT_SOFTNESS = 13,
            
            /** Constant for accessing [member angular_limit/restitution]. The amount of restitution of the rotation when the limit is surpassed. */
            PARAM_ANGULAR_LIMIT_RESTITUTION = 14,
            
            /** Constant for accessing [member angular_limit/damping]. The amount of damping of the rotation when the limit is surpassed. */
            PARAM_ANGULAR_LIMIT_DAMPING = 15,
            
            /** Constant for accessing [member angular_motion/softness]. A factor applied to the all rotation in the limits. */
            PARAM_ANGULAR_MOTION_SOFTNESS = 16,
            
            /** Constant for accessing [member angular_motion/restitution]. The amount of restitution of the rotation in the limits. */
            PARAM_ANGULAR_MOTION_RESTITUTION = 17,
            
            /** Constant for accessing [member angular_motion/damping]. The amount of damping of the rotation in the limits. */
            PARAM_ANGULAR_MOTION_DAMPING = 18,
            
            /** Constant for accessing [member angular_ortho/softness]. A factor applied to the all rotation across axes orthogonal to the slider. */
            PARAM_ANGULAR_ORTHOGONAL_SOFTNESS = 19,
            
            /** Constant for accessing [member angular_ortho/restitution]. The amount of restitution of the rotation across axes orthogonal to the slider. */
            PARAM_ANGULAR_ORTHOGONAL_RESTITUTION = 20,
            
            /** Constant for accessing [member angular_ortho/damping]. The amount of damping of the rotation across axes orthogonal to the slider. */
            PARAM_ANGULAR_ORTHOGONAL_DAMPING = 21,
            
            /** Represents the size of the [enum Param] enum. */
            PARAM_MAX = 22,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSliderJoint3D extends __NameMapJoint3D {
    }
    /** A physics joint that restricts the movement of a 3D physics body along an axis relative to another physics body.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_sliderjoint3d.html  
     */
    class SliderJoint3D<Map extends NodePathMap = any> extends Joint3D<Map> {
        constructor(identifier?: any)
        /** Assigns [param value] to the given parameter. */
        set_param(param: SliderJoint3D.Param, value: float64): void
        
        /** Returns the value of the given parameter. */
        get_param(param: SliderJoint3D.Param): float64
        
        /** The maximum difference between the pivot points on their X axis before damping happens. */
        get "linear_limit/upper_distance"(): float64
        set "linear_limit/upper_distance"(value: float64)
        
        /** The minimum difference between the pivot points on their X axis before damping happens. */
        get "linear_limit/lower_distance"(): float64
        set "linear_limit/lower_distance"(value: float64)
        
        /** A factor applied to the movement across the slider axis once the limits get surpassed. The lower, the slower the movement. */
        get "linear_limit/softness"(): float64
        set "linear_limit/softness"(value: float64)
        
        /** The amount of restitution once the limits are surpassed. The lower, the more velocity-energy gets lost. */
        get "linear_limit/restitution"(): float64
        set "linear_limit/restitution"(value: float64)
        
        /** The amount of damping that happens once the limit defined by [member linear_limit/lower_distance] and [member linear_limit/upper_distance] is surpassed. */
        get "linear_limit/damping"(): float64
        set "linear_limit/damping"(value: float64)
        
        /** A factor applied to the movement across the slider axis as long as the slider is in the limits. The lower, the slower the movement. */
        get "linear_motion/softness"(): float64
        set "linear_motion/softness"(value: float64)
        
        /** The amount of restitution inside the slider limits. */
        get "linear_motion/restitution"(): float64
        set "linear_motion/restitution"(value: float64)
        
        /** The amount of damping inside the slider limits. */
        get "linear_motion/damping"(): float64
        set "linear_motion/damping"(value: float64)
        
        /** A factor applied to the movement across axes orthogonal to the slider. */
        get "linear_ortho/softness"(): float64
        set "linear_ortho/softness"(value: float64)
        
        /** The amount of restitution when movement is across axes orthogonal to the slider. */
        get "linear_ortho/restitution"(): float64
        set "linear_ortho/restitution"(value: float64)
        
        /** The amount of damping when movement is across axes orthogonal to the slider. */
        get "linear_ortho/damping"(): float64
        set "linear_ortho/damping"(value: float64)
        
        /** The upper limit of rotation in the slider. */
        get "angular_limit/upper_angle"(): float64
        set "angular_limit/upper_angle"(value: float64)
        
        /** The lower limit of rotation in the slider. */
        get "angular_limit/lower_angle"(): float64
        set "angular_limit/lower_angle"(value: float64)
        
        /** A factor applied to the all rotation once the limit is surpassed.  
         *  Makes all rotation slower when between 0 and 1.  
         */
        get "angular_limit/softness"(): float64
        set "angular_limit/softness"(value: float64)
        
        /** The amount of restitution of the rotation when the limit is surpassed.  
         *  Does not affect damping.  
         */
        get "angular_limit/restitution"(): float64
        set "angular_limit/restitution"(value: float64)
        
        /** The amount of damping of the rotation when the limit is surpassed.  
         *  A lower damping value allows a rotation initiated by body A to travel to body B slower.  
         */
        get "angular_limit/damping"(): float64
        set "angular_limit/damping"(value: float64)
        
        /** A factor applied to the all rotation in the limits. */
        get "angular_motion/softness"(): float64
        set "angular_motion/softness"(value: float64)
        
        /** The amount of restitution of the rotation in the limits. */
        get "angular_motion/restitution"(): float64
        set "angular_motion/restitution"(value: float64)
        
        /** The amount of damping of the rotation in the limits. */
        get "angular_motion/damping"(): float64
        set "angular_motion/damping"(value: float64)
        
        /** A factor applied to the all rotation across axes orthogonal to the slider. */
        get "angular_ortho/softness"(): float64
        set "angular_ortho/softness"(value: float64)
        
        /** The amount of restitution of the rotation across axes orthogonal to the slider. */
        get "angular_ortho/restitution"(): float64
        set "angular_ortho/restitution"(value: float64)
        
        /** The amount of damping of the rotation across axes orthogonal to the slider. */
        get "angular_ortho/damping"(): float64
        set "angular_ortho/damping"(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSliderJoint3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSocketServer extends __NameMapRefCounted {
    }
    /** An abstract class for servers based on sockets.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_socketserver.html  
     */
    class SocketServer extends RefCounted {
        constructor(identifier?: any)
        /** Returns `true` if a connection is available for taking. */
        is_connection_available(): boolean
        
        /** Returns `true` if the server is currently listening for connections. */
        is_listening(): boolean
        
        /** Stops listening. */
        stop(): void
        
        /** If a connection is available, returns a StreamPeerSocket with the connection. */
        take_socket_connection(): null | StreamPeerSocket
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSocketServer;
    }
    namespace SoftBody3D {
        enum DisableMode {
            /** When [member Node.process_mode] is set to [constant Node.PROCESS_MODE_DISABLED], remove from the physics simulation to stop all physics interactions with this [SoftBody3D].  
             *  Automatically re-added to the physics simulation when the [Node] is processed again.  
             */
            DISABLE_MODE_REMOVE = 0,
            
            /** When [member Node.process_mode] is set to [constant Node.PROCESS_MODE_DISABLED], do not affect the physics simulation. */
            DISABLE_MODE_KEEP_ACTIVE = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSoftBody3D extends __NameMapMeshInstance3D {
    }
    /** A deformable 3D physics mesh.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_softbody3d.html  
     */
    class SoftBody3D<Map extends NodePathMap = any> extends MeshInstance3D<Map> {
        constructor(identifier?: any)
        /** Returns the internal [RID] used by the [PhysicsServer3D] for this body. */
        get_physics_rid(): RID
        
        /** Based on [param value], enables or disables the specified layer in the [member collision_mask], given a [param layer_number] between 1 and 32. */
        set_collision_mask_value(layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified layer of the [member collision_mask] is enabled, given a [param layer_number] between 1 and 32. */
        get_collision_mask_value(layer_number: int64): boolean
        
        /** Based on [param value], enables or disables the specified layer in the [member collision_layer], given a [param layer_number] between 1 and 32. */
        set_collision_layer_value(layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified layer of the [member collision_layer] is enabled, given a [param layer_number] between 1 and 32. */
        get_collision_layer_value(layer_number: int64): boolean
        
        /** Returns an array of nodes that were added as collision exceptions for this body. */
        get_collision_exceptions(): GArray<PhysicsBody3D>
        
        /** Adds a body to the list of bodies that this body can't collide with. */
        add_collision_exception_with(body: Node): void
        
        /** Removes a body from the list of bodies that this body can't collide with. */
        remove_collision_exception_with(body: Node): void
        
        /** Returns local translation of a vertex in the surface array. */
        get_point_transform(point_index: int64): Vector3
        
        /** Applies an impulse to a point.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         */
        apply_impulse(point_index: int64, impulse: Vector3): void
        
        /** Applies a force to a point. A force is time dependent and meant to be applied every physics update. */
        apply_force(point_index: int64, force: Vector3): void
        
        /** Distributes and applies an impulse to all points.  
         *  An impulse is time-independent! Applying an impulse every frame would result in a framerate-dependent force. For this reason, it should only be used when simulating one-time impacts (use the "_force" functions otherwise).  
         */
        apply_central_impulse(impulse: Vector3): void
        
        /** Distributes and applies a force to all points. A force is time dependent and meant to be applied every physics update. */
        apply_central_force(force: Vector3): void
        
        /** Sets the pinned state of a surface vertex. When set to `true`, the optional [param attachment_path] can define a [Node3D] the pinned vertex will be attached to. */
        set_point_pinned(point_index: int64, pinned: boolean, attachment_path?: NodePath | string /* = '' */, insert_at?: int64 /* = -1 */): void
        
        /** Returns `true` if vertex is set to pinned. */
        is_point_pinned(point_index: int64): boolean
        
        /** The physics layers this SoftBody3D **is in**. Collision objects can exist in one or more of 32 different layers. See also [member collision_mask].  
         *      
         *  **Note:** Object A can detect a contact with object B only if object B is in any of the layers that object A scans. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information.  
         */
        get collision_layer(): int64
        set collision_layer(value: int64)
        
        /** The physics layers this SoftBody3D **scans**. Collision objects can scan one or more of 32 different layers. See also [member collision_layer].  
         *      
         *  **Note:** Object A can detect a contact with object B only if object B is in any of the layers that object A scans. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information.  
         */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** [NodePath] to a [CollisionObject3D] this SoftBody3D should avoid clipping. */
        get parent_collision_ignore(): NodePath
        set parent_collision_ignore(value: NodePath | string)
        
        /** Increasing this value will improve the resulting simulation, but can affect performance. Use with care. */
        get simulation_precision(): int64
        set simulation_precision(value: int64)
        
        /** The SoftBody3D's mass.  
         *      
         *  **Note:** When using Jolt Physics, the default value of this property will instead be `0.0`, which will cause the body to automatically calculate the mass to 1 kg per point. This is a bug, which will be fixed in Godot 4.7.  
         */
        get total_mass(): float64
        set total_mass(value: float64)
        
        /** Higher values will result in a stiffer body, while lower values will increase the body's ability to bend. The value can be between `0.0` and `1.0` (inclusive). */
        get linear_stiffness(): float64
        set linear_stiffness(value: float64)
        
        /** Scales the rest lengths of [SoftBody3D]'s edge constraints. Positive values shrink the mesh, while negative values expand it. For example, a value of `0.1` shortens the edges of the mesh by 10%, while `-0.1` expands the edges by 10%.  
         *      
         *  **Note:** [member shrinking_factor] is best used on surface meshes with pinned points.  
         */
        get shrinking_factor(): float64
        set shrinking_factor(value: float64)
        
        /** The pressure coefficient of this soft body. Simulate pressure build-up from inside this body. Higher values increase the strength of this effect. */
        get pressure_coefficient(): float64
        set pressure_coefficient(value: float64)
        
        /** The body's damping coefficient. Higher values will slow down the body more noticeably when forces are applied. */
        get damping_coefficient(): float64
        set damping_coefficient(value: float64)
        
        /** The body's drag coefficient. Higher values increase this body's air resistance.  
         *      
         *  **Note:** This value is currently unused by Godot's default physics implementation.  
         */
        get drag_coefficient(): float64
        set drag_coefficient(value: float64)
        
        /** If `true`, the [SoftBody3D] will respond to [RayCast3D]s. */
        get ray_pickable(): boolean
        set ray_pickable(value: boolean)
        
        /** Defines the behavior in physics when [member Node.process_mode] is set to [constant Node.PROCESS_MODE_DISABLED]. */
        get disable_mode(): int64
        set disable_mode(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSoftBody3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSphereMesh extends __NameMapPrimitiveMesh {
    }
    /** Class representing a spherical [PrimitiveMesh].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_spheremesh.html  
     */
    class SphereMesh extends PrimitiveMesh {
        constructor(identifier?: any)
        /** Radius of sphere. */
        get radius(): float64
        set radius(value: float64)
        
        /** Full height of the sphere. */
        get height(): float64
        set height(value: float64)
        
        /** Number of radial segments on the sphere. */
        get radial_segments(): int64
        set radial_segments(value: int64)
        
        /** Number of segments along the height of the sphere. */
        get rings(): int64
        set rings(value: int64)
        
        /** If `true`, a hemisphere is created rather than a full sphere.  
         *      
         *  **Note:** To get a regular hemisphere, the height and radius of the sphere must be equal.  
         */
        get is_hemisphere(): boolean
        set is_hemisphere(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSphereMesh;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSphereOccluder3D extends __NameMapOccluder3D {
    }
    /** Spherical shape for use with occlusion culling in [OccluderInstance3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_sphereoccluder3d.html  
     */
    class SphereOccluder3D extends Occluder3D {
        constructor(identifier?: any)
        /** The sphere's radius in 3D units. */
        get radius(): float64
        set radius(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSphereOccluder3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSphereShape3D extends __NameMapShape3D {
    }
    /** A 3D sphere shape used for physics collision.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_sphereshape3d.html  
     */
    class SphereShape3D extends Shape3D {
        constructor(identifier?: any)
        /** The sphere's radius. The shape's diameter is double the radius. */
        get radius(): float64
        set radius(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSphereShape3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpinBox extends __NameMapRange {
    }
    /** An input field for numbers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_spinbox.html  
     */
    class SpinBox<Map extends NodePathMap = any> extends Range<Map> {
        constructor(identifier?: any)
        /** Applies the current value of this [SpinBox]. This is equivalent to pressing [kbd]Enter[/kbd] while editing the [LineEdit] used by the [SpinBox]. This will cause [signal LineEdit.text_submitted] to be emitted and its currently contained expression to be evaluated. */
        apply(): void
        
        /** Returns the [LineEdit] instance from this [SpinBox]. You can use it to access properties and methods of [LineEdit].  
         *  **Warning:** This is a required internal node, removing and freeing it may cause a crash. If you wish to hide it or any of its children, use their [member CanvasItem.visible] property.  
         */
        get_line_edit(): null | LineEdit
        
        /** Changes the alignment of the underlying [LineEdit]. */
        get alignment(): int64
        set alignment(value: int64)
        
        /** If `true`, the [SpinBox] will be editable. Otherwise, it will be read only. */
        get editable(): boolean
        set editable(value: boolean)
        
        /** Sets the value of the [Range] for this [SpinBox] when the [LineEdit] text is  *changed*  instead of  *submitted* . See [signal LineEdit.text_changed] and [signal LineEdit.text_submitted].  
         *      
         *  **Note:** If set to `true`, this will interfere with entering mathematical expressions in the [SpinBox]. The [SpinBox] will try to evaluate the expression as you type, which means symbols like a trailing `+` are removed immediately by the expression being evaluated.  
         */
        get update_on_text_changed(): boolean
        set update_on_text_changed(value: boolean)
        
        /** Adds the specified prefix string before the numerical value of the [SpinBox]. */
        get prefix(): string
        set prefix(value: string)
        
        /** Adds the specified suffix string after the numerical value of the [SpinBox]. */
        get suffix(): string
        set suffix(value: string)
        
        /** If not `0`, sets the step when interacting with the arrow buttons of the [SpinBox].  
         *      
         *  **Note:** [member Range.value] will still be rounded to a multiple of [member Range.step].  
         */
        get custom_arrow_step(): float64
        set custom_arrow_step(value: float64)
        
        /** If `true`, the value will be rounded to a multiple of [member custom_arrow_step] when interacting with the arrow buttons. Otherwise, increments the value by [member custom_arrow_step] and then rounds it according to [member Range.step]. */
        get custom_arrow_round(): boolean
        set custom_arrow_round(value: boolean)
        
        /** If `true`, the [SpinBox] will select the whole text when the [LineEdit] gains focus. Clicking the up and down arrows won't trigger this behavior. */
        get select_all_on_focus(): boolean
        set select_all_on_focus(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpinBox;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSplineIK3D extends __NameMapChainIK3D {
    }
    /** A [SkeletonModifier3D] for aligning bones along a [Path3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_splineik3d.html  
     */
    class SplineIK3D<Map extends NodePathMap = any> extends ChainIK3D<Map> {
        constructor(identifier?: any)
        /** Sets the node path of the [Path3D] which is describing the path. */
        set_path_3d(index: int64, path_3d: NodePath | string): void
        
        /** Returns the node path of the [Path3D] which is describing the path. */
        get_path_3d(index: int64): NodePath
        
        /** Sets if the tilt property of the [Curve3D] should affect the bone twist. */
        set_tilt_enabled(index: int64, enabled: boolean): void
        
        /** Returns if the tilt property of the [Curve3D] affects the bone twist. */
        is_tilt_enabled(index: int64): boolean
        
        /** If [param size] is greater than `0`, the tilt is interpolated between [param size] start bones from the start point of the [Curve3D] when they are apart.  
         *  If [param size] is equal `0`, the tilts between the root bone head and the start point of the [Curve3D] are unified with a tilt of the start point of the [Curve3D].  
         *  If [param size] is less than `0`, the tilts between the root bone and the start point of the [Curve3D] are `0.0`.  
         */
        set_tilt_fade_in(index: int64, size: int64): void
        
        /** Returns the tilt interpolation method used between the root bone and the start point of the [Curve3D] when they are apart. See also [method set_tilt_fade_in]. */
        get_tilt_fade_in(index: int64): int64
        
        /** If [param size] is greater than `0`, the tilt is interpolated between [param size] end bones from the end point of the [Curve3D] when they are apart.  
         *  If [param size] is equal `0`, the tilts between the end bone tail and the end point of the [Curve3D] are unified with a tilt of the end point of the [Curve3D].  
         *  If [param size] is less than `0`, the tilts between the end bone and the end point of the [Curve3D] are `0.0`.  
         */
        set_tilt_fade_out(index: int64, size: int64): void
        
        /** Returns the tilt interpolation method used between the end bone and the end point of the [Curve3D] when they are apart. See also [method set_tilt_fade_out]. */
        get_tilt_fade_out(index: int64): int64
        
        /** The number of settings. */
        get setting_count(): int64
        set setting_count(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSplineIK3D;
    }
    namespace SplitContainer {
        enum DraggerVisibility {
            /** The split dragger icon is always visible when [theme_item autohide] is `false`, otherwise visible only when the cursor hovers it.  
             *  The size of the grabber icon determines the minimum [theme_item separation].  
             *  The dragger icon is automatically hidden if the length of the grabber icon is longer than the split bar.  
             */
            DRAGGER_VISIBLE = 0,
            
            /** The split dragger icon is never visible regardless of the value of [theme_item autohide].  
             *  The size of the grabber icon determines the minimum [theme_item separation].  
             */
            DRAGGER_HIDDEN = 1,
            
            /** The split dragger icon is not visible, and the split bar is collapsed to zero thickness. */
            DRAGGER_HIDDEN_COLLAPSED = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSplitContainer extends __NameMapContainer {
    }
    /** A container that arranges child controls horizontally or vertically and provides grabbers for adjusting the split ratios between them.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_splitcontainer.html  
     */
    class SplitContainer<Map extends NodePathMap = any> extends Container<Map> {
        constructor(identifier?: any)
        /** Clamps the [member split_offsets] values to ensure they are within valid ranges and do not overlap with each other. When overlaps occur, this method prioritizes one split offset (at index [param priority_index]) by clamping any overlapping split offsets to it. */
        clamp_split_offset(priority_index?: int64 /* = 0 */): void
        
        /** Returns an [Array] of the drag area [Control]s. These are the interactable [Control] nodes between each child. For example, this can be used to add a pre-configured button to a drag area [Control] so that it rides along with the split bar. Try setting the [Button] anchors to `center` prior to the [method Node.reparent] call.  
         *    
         *      
         *  **Note:** The drag area [Control]s are drawn over the [SplitContainer]'s children, so [CanvasItem] draw objects called from a drag area and children added to it will also appear over the [SplitContainer]'s children. Try setting [member Control.mouse_filter] of custom children to [constant Control.MOUSE_FILTER_IGNORE] to prevent blocking the mouse from dragging if desired.  
         *  **Warning:** These are required internal nodes, removing or freeing them may cause a crash.  
         */
        get_drag_area_controls(): GArray<Control>
        
        /** Returns the drag area [Control]. For example, you can move a pre-configured button into the drag area [Control] so that it rides along with the split bar. Try setting the [Button] anchors to `center` prior to the `reparent()` call.  
         *    
         *      
         *  **Note:** The drag area [Control] is drawn over the [SplitContainer]'s children, so [CanvasItem] draw objects called from the [Control] and children added to the [Control] will also appear over the [SplitContainer]'s children. Try setting [member Control.mouse_filter] of custom children to [constant Control.MOUSE_FILTER_IGNORE] to prevent blocking the mouse from dragging if desired.  
         *  **Warning:** This is a required internal node, removing and freeing it may cause a crash.  
         */
        get_drag_area_control(): null | Control
        
        /** Offsets for each dragger in pixels. Each one is the offset of the split between the [Control] nodes before and after the dragger, with `0` being the default position. The default position is based on the [Control] nodes expand flags and minimum sizes. See [member Control.size_flags_horizontal], [member Control.size_flags_vertical], and [member Control.size_flags_stretch_ratio].  
         *  If none of the [Control] nodes before the dragger are expanded, the default position will be at the start of the [SplitContainer]. If none of the [Control] nodes after the dragger are expanded, the default position will be at the end of the [SplitContainer]. If the dragger is in between expanded [Control] nodes, the default position will be in the middle, based on the [member Control.size_flags_stretch_ratio]s and minimum sizes.  
         *      
         *  **Note:** If the split offsets cause [Control] nodes to overlap, the first split will take priority when resolving the positions.  
         */
        get split_offsets(): PackedInt32Array
        set split_offsets(value: PackedInt32Array | int32[])
        
        /** If `true`, the draggers will be disabled and the children will be sized as if all [member split_offsets] were `0`. */
        get collapsed(): boolean
        set collapsed(value: boolean)
        
        /** Enables or disables split dragging. */
        get dragging_enabled(): boolean
        set dragging_enabled(value: boolean)
        
        /** Determines the dragger's visibility. This property does not determine whether dragging is enabled or not. Use [member dragging_enabled] for that. */
        get dragger_visibility(): int64
        set dragger_visibility(value: int64)
        
        /** If `true`, the [SplitContainer] will arrange its children vertically, rather than horizontally.  
         *  Can't be changed when using [HSplitContainer] and [VSplitContainer].  
         */
        get vertical(): boolean
        set vertical(value: boolean)
        
        /** If `true`, a touch-friendly drag handle will be enabled for better usability on smaller screens. Unlike the standard grabber, this drag handle overlaps the [SplitContainer]'s children and does not affect their minimum separation. The standard grabber will no longer be drawn when this option is enabled. */
        get touch_dragger_enabled(): boolean
        set touch_dragger_enabled(value: boolean)
        
        /** Reduces the size of the drag area and split bar [theme_item split_bar_background] at the beginning of the container. */
        get drag_area_margin_begin(): int64
        set drag_area_margin_begin(value: int64)
        
        /** Reduces the size of the drag area and split bar [theme_item split_bar_background] at the end of the container. */
        get drag_area_margin_end(): int64
        set drag_area_margin_end(value: int64)
        
        /** Shifts the drag area in the axis of the container to prevent the drag area from overlapping the [ScrollBar] or other selectable [Control] of a child node. */
        get drag_area_offset(): int64
        set drag_area_offset(value: int64)
        
        /** Highlights the drag area [Rect2] so you can see where it is during development. The drag area is gold if [member dragging_enabled] is `true`, and red if `false`. */
        get drag_area_highlight_in_editor(): boolean
        set drag_area_highlight_in_editor(value: boolean)
        
        /** The first element of [member split_offsets]. */
        get split_offset(): int64
        set split_offset(value: int64)
        
        /** Emitted when any dragger is dragged by user. */
        readonly dragged: Signal<(offset: int64) => void>
        
        /** Emitted when the user starts dragging. */
        readonly drag_started: Signal<() => void>
        
        /** Emitted when the user ends dragging. */
        readonly drag_ended: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSplitContainer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpotLight3D extends __NameMapLight3D {
    }
    /** A spotlight, such as a reflector spotlight or a lantern.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_spotlight3d.html  
     */
    class SpotLight3D<Map extends NodePathMap = any> extends Light3D<Map> {
        constructor(identifier?: any)
        /** The maximal range that can be reached by the spotlight. Note that the effectively lit area may appear to be smaller depending on the [member spot_attenuation] in use. No matter the [member spot_attenuation] in use, the light will never reach anything outside this range.  
         *      
         *  **Note:** [member spot_range] is not affected by [member Node3D.scale] (the light's scale or its parent's scale).  
         */
        get spot_range(): float64
        set spot_range(value: float64)
        
        /** Controls the distance attenuation function for spotlights.  
         *  A value of `0.0` will maintain a constant brightness through most of the range, but smoothly attenuate the light at the edge of the range. Use a value of `2.0` for physically accurate lights as it results in the proper inverse square attenutation.  
         *      
         *  **Note:** Setting attenuation to `2.0` or higher may result in distant objects receiving minimal light, even within range. For example, with a range of `4096`, an object at `100` units is attenuated by a factor of `0.0001`. With a default brightness of `1`, the light would not be visible at that distance.  
         *      
         *  **Note:** Using negative or values higher than `10.0` may lead to unexpected results.  
         */
        get spot_attenuation(): float64
        set spot_attenuation(value: float64)
        
        /** The spotlight's angle in degrees. This is the angular radius, meaning the angle from the -Z axis, the cone's center, to the edge of the cone. The default angular radius of 45 degrees corresponds to a cone with an angular diameter of 90 degrees.  
         *      
         *  **Note:** [member spot_angle] is not affected by [member Node3D.scale] (the light's scale or its parent's scale).  
         */
        get spot_angle(): float64
        set spot_angle(value: float64)
        
        /** The spotlight's  *angular*  attenuation curve. See also [member spot_attenuation]. */
        get spot_angle_attenuation(): float64
        set spot_angle_attenuation(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpotLight3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpringArm3D extends __NameMapNode3D {
    }
    /** A 3D raycast that dynamically moves its children near the collision point.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_springarm3d.html  
     */
    class SpringArm3D<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Returns the spring arm's current length. */
        get_hit_length(): float64
        
        /** Adds the [PhysicsBody3D] object with the given [RID] to the list of [PhysicsBody3D] objects excluded from the collision check. */
        add_excluded_object(RID: RID): void
        
        /** Removes the given [RID] from the list of [PhysicsBody3D] objects excluded from the collision check. */
        remove_excluded_object(RID: RID): boolean
        
        /** Clears the list of [PhysicsBody3D] objects excluded from the collision check. */
        clear_excluded_objects(): void
        
        /** The layers against which the collision check will be done. See [url=https://docs.godotengine.org/en/4.6/tutorials/physics/physics_introduction.html#collision-layers-and-masks]Collision layers and masks[/url] in the documentation for more information. */
        get collision_mask(): int64
        set collision_mask(value: int64)
        
        /** The [Shape3D] to use for the SpringArm3D.  
         *  When the shape is set, the SpringArm3D will cast the [Shape3D] on its z axis instead of performing a ray cast.  
         */
        get shape(): null | Shape3D
        set shape(value: null | Shape3D)
        
        /** The maximum extent of the SpringArm3D. This is used as a length for both the ray and the shape cast used internally to calculate the desired position of the SpringArm3D's child nodes.  
         *  To know more about how to perform a shape cast or a ray cast, please consult the [PhysicsDirectSpaceState3D] documentation.  
         */
        get spring_length(): float64
        set spring_length(value: float64)
        
        /** When the collision check is made, a candidate length for the SpringArm3D is given.  
         *  The margin is then subtracted to this length and the translation is applied to the child objects of the SpringArm3D.  
         *  This margin is useful for when the SpringArm3D has a [Camera3D] as a child node: without the margin, the [Camera3D] would be placed on the exact point of collision, while with the margin the [Camera3D] would be placed close to the point of collision.  
         */
        get margin(): float64
        set margin(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpringArm3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpringBoneCollision3D extends __NameMapNode3D {
    }
    /** A base class of the collision that interacts with [SpringBoneSimulator3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_springbonecollision3d.html  
     */
    class SpringBoneCollision3D<Map extends NodePathMap = any> extends Node3D<Map> {
        constructor(identifier?: any)
        /** Get parent [Skeleton3D] node of the parent [SpringBoneSimulator3D] if found. */
        get_skeleton(): null | Skeleton3D
        
        /** The name of the attached bone. */
        get bone_name(): StringName
        set bone_name(value: StringName)
        
        /** The index of the attached bone. */
        get bone(): int64
        set bone(value: int64)
        
        /** The offset of the position from [Skeleton3D]'s [member bone] pose position. */
        get position_offset(): Vector3
        set position_offset(value: Vector3)
        
        /** The offset of the rotation from [Skeleton3D]'s [member bone] pose rotation. */
        get rotation_offset(): Quaternion
        set rotation_offset(value: Quaternion)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpringBoneCollision3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpringBoneCollisionCapsule3D extends __NameMapSpringBoneCollision3D {
    }
    /** A capsule shape collision that interacts with [SpringBoneSimulator3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_springbonecollisioncapsule3d.html  
     */
    class SpringBoneCollisionCapsule3D<Map extends NodePathMap = any> extends SpringBoneCollision3D<Map> {
        constructor(identifier?: any)
        /** The capsule's radius.  
         *      
         *  **Note:** The [member radius] of a capsule cannot be greater than half of its [member height]. Otherwise, the capsule becomes a sphere. If the [member radius] is greater than half of the [member height], the properties adjust to a valid value.  
         */
        get radius(): float64
        set radius(value: float64)
        
        /** The capsule's full height, including the hemispheres.  
         *      
         *  **Note:** The [member height] of a capsule must be at least twice its [member radius]. Otherwise, the capsule becomes a sphere. If the [member height] is less than twice the [member radius], the properties adjust to a valid value.  
         */
        get height(): float64
        set height(value: float64)
        
        /** The capsule's height, excluding the hemispheres. This is the height of the central cylindrical part in the middle of the capsule, and is the distance between the centers of the two hemispheres. This is a wrapper for [member height]. */
        get mid_height(): float64
        set mid_height(value: float64)
        
        /** If `true`, the collision acts to trap the joint within the collision. */
        get inside(): boolean
        set inside(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpringBoneCollisionCapsule3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpringBoneCollisionPlane3D extends __NameMapSpringBoneCollision3D {
    }
    /** An infinite plane collision that interacts with [SpringBoneSimulator3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_springbonecollisionplane3d.html  
     */
    class SpringBoneCollisionPlane3D<Map extends NodePathMap = any> extends SpringBoneCollision3D<Map> {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpringBoneCollisionPlane3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpringBoneCollisionSphere3D extends __NameMapSpringBoneCollision3D {
    }
    /** A sphere shape collision that interacts with [SpringBoneSimulator3D].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_springbonecollisionsphere3d.html  
     */
    class SpringBoneCollisionSphere3D<Map extends NodePathMap = any> extends SpringBoneCollision3D<Map> {
        constructor(identifier?: any)
        /** The sphere's radius. */
        get radius(): float64
        set radius(value: float64)
        
        /** If `true`, the collision acts to trap the joint within the collision. */
        get inside(): boolean
        set inside(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpringBoneCollisionSphere3D;
    }
    namespace SpringBoneSimulator3D {
        enum CenterFrom {
            /** The world origin is defined as center. */
            CENTER_FROM_WORLD_ORIGIN = 0,
            
            /** The [Node3D] specified by [method set_center_node] is defined as center.  
             *  If [Node3D] is not found, the parent [Skeleton3D] is treated as center.  
             */
            CENTER_FROM_NODE = 1,
            
            /** The bone pose origin of the parent [Skeleton3D] specified by [method set_center_bone] is defined as center.  
             *  If [Node3D] is not found, the parent [Skeleton3D] is treated as center.  
             */
            CENTER_FROM_BONE = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpringBoneSimulator3D extends __NameMapSkeletonModifier3D {
    }
    /** A [SkeletonModifier3D] to apply inertial wavering to bone chains.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_springbonesimulator3d.html  
     */
    class SpringBoneSimulator3D<Map extends NodePathMap = any> extends SkeletonModifier3D<Map> {
        constructor(identifier?: any)
        /** Sets the root bone name of the bone chain. */
        set_root_bone_name(index: int64, bone_name: string): void
        
        /** Returns the root bone name of the bone chain. */
        get_root_bone_name(index: int64): string
        
        /** Sets the root bone index of the bone chain. */
        set_root_bone(index: int64, bone: int64): void
        
        /** Returns the root bone index of the bone chain. */
        get_root_bone(index: int64): int64
        
        /** Sets the end bone name of the bone chain.  
         *      
         *  **Note:** End bone must be the root bone or a child of the root bone. If they are the same, the tail must be extended by [method set_extend_end_bone] to jiggle the bone.  
         */
        set_end_bone_name(index: int64, bone_name: string): void
        
        /** Returns the end bone name of the bone chain. */
        get_end_bone_name(index: int64): string
        
        /** Sets the end bone index of the bone chain. */
        set_end_bone(index: int64, bone: int64): void
        
        /** Returns the end bone index of the bone chain. */
        get_end_bone(index: int64): int64
        
        /** If [param enabled] is `true`, the end bone is extended to have a tail.  
         *  The extended tail config is allocated to the last element in the joint list. In other words, if you set [param enabled] to `false`, the config of the last element in the joint list has no effect in the simulated result.  
         */
        set_extend_end_bone(index: int64, enabled: boolean): void
        
        /** Returns `true` if the end bone is extended to have a tail. */
        is_end_bone_extended(index: int64): boolean
        
        /** Sets the end bone tail direction of the bone chain when [method is_end_bone_extended] is `true`. */
        set_end_bone_direction(index: int64, bone_direction: SkeletonModifier3D.BoneDirection): void
        
        /** Returns the tail direction of the end bone of the bone chain when [method is_end_bone_extended] is `true`. */
        get_end_bone_direction(index: int64): SkeletonModifier3D.BoneDirection
        
        /** Sets the end bone tail length of the bone chain when [method is_end_bone_extended] is `true`. */
        set_end_bone_length(index: int64, length: float64): void
        
        /** Returns the end bone tail length of the bone chain when [method is_end_bone_extended] is `true`. */
        get_end_bone_length(index: int64): float64
        
        /** Sets what the center originates from in the bone chain.  
         *  Bone movement is calculated based on the difference in relative distance between center and bone in the previous and next frames.  
         *  For example, if the parent [Skeleton3D] is used as the center, the bones are considered to have not moved if the [Skeleton3D] moves in the world.  
         *  In this case, only a change in the bone pose is considered to be a bone movement.  
         */
        set_center_from(index: int64, center_from: SpringBoneSimulator3D.CenterFrom): void
        
        /** Returns what the center originates from in the bone chain. */
        get_center_from(index: int64): SpringBoneSimulator3D.CenterFrom
        
        /** Sets the center node path of the bone chain. */
        set_center_node(index: int64, node_path: NodePath | string): void
        
        /** Returns the center node path of the bone chain. */
        get_center_node(index: int64): NodePath
        
        /** Sets the center bone name of the bone chain. */
        set_center_bone_name(index: int64, bone_name: string): void
        
        /** Returns the center bone name of the bone chain. */
        get_center_bone_name(index: int64): string
        
        /** Sets the center bone index of the bone chain. */
        set_center_bone(index: int64, bone: int64): void
        
        /** Returns the center bone index of the bone chain. */
        get_center_bone(index: int64): int64
        
        /** Sets the joint radius of the bone chain. It is used to move and slide with the [SpringBoneCollision3D] in the collision list.  
         *  The value is scaled by [method set_radius_damping_curve] and cached in each joint setting in the joint list.  
         */
        set_radius(index: int64, radius: float64): void
        
        /** Returns the joint radius of the bone chain. */
        get_radius(index: int64): float64
        
        /** Sets the rotation axis of the bone chain. If set to a specific axis, it acts like a hinge joint. The value is cached in each joint setting in the joint list.  
         *  The axes are based on the [method Skeleton3D.get_bone_rest]'s space, if [param axis] is [constant SkeletonModifier3D.ROTATION_AXIS_CUSTOM], you can specify any axis.  
         *      
         *  **Note:** The rotation axis vector and the forward vector shouldn't be colinear to avoid unintended rotation since [SpringBoneSimulator3D] does not factor in twisting forces.  
         */
        set_rotation_axis(index: int64, axis: SkeletonModifier3D.RotationAxis): void
        
        /** Returns the rotation axis of the bone chain. */
        get_rotation_axis(index: int64): SkeletonModifier3D.RotationAxis
        
        /** Sets the rotation axis vector of the bone chain. The value is cached in each joint setting in the joint list.  
         *  This vector is normalized by an internal process and represents the axis around which the bone chain can rotate.  
         *  If the vector length is `0`, it is considered synonymous with [constant SkeletonModifier3D.ROTATION_AXIS_ALL].  
         */
        set_rotation_axis_vector(index: int64, vector: Vector3): void
        
        /** Returns the rotation axis vector of the bone chain. This vector represents the axis around which the bone chain can rotate. It is determined based on the rotation axis set for the bone chain.  
         *  If [method get_rotation_axis] is [constant SkeletonModifier3D.ROTATION_AXIS_ALL], this method returns `Vector3(0, 0, 0)`.  
         */
        get_rotation_axis_vector(index: int64): Vector3
        
        /** Sets the joint radius damping curve of the bone chain. */
        set_radius_damping_curve(index: int64, curve: Curve): void
        
        /** Returns the joint radius damping curve of the bone chain. */
        get_radius_damping_curve(index: int64): null | Curve
        
        /** Sets the stiffness force of the bone chain. The greater the value, the faster it recovers to its initial pose.  
         *  If [param stiffness] is `0`, the modified pose will not return to the original pose.  
         *  The value is scaled by [method set_stiffness_damping_curve] and cached in each joint setting in the joint list.  
         */
        set_stiffness(index: int64, stiffness: float64): void
        
        /** Returns the stiffness force of the bone chain. */
        get_stiffness(index: int64): float64
        
        /** Sets the stiffness force damping curve of the bone chain. */
        set_stiffness_damping_curve(index: int64, curve: Curve): void
        
        /** Returns the stiffness force damping curve of the bone chain. */
        get_stiffness_damping_curve(index: int64): null | Curve
        
        /** Sets the drag force of the bone chain. The greater the value, the more suppressed the wiggling.  
         *  The value is scaled by [method set_drag_damping_curve] and cached in each joint setting in the joint list.  
         */
        set_drag(index: int64, drag: float64): void
        
        /** Returns the drag force damping curve of the bone chain. */
        get_drag(index: int64): float64
        
        /** Sets the drag force damping curve of the bone chain. */
        set_drag_damping_curve(index: int64, curve: Curve): void
        
        /** Returns the drag force damping curve of the bone chain. */
        get_drag_damping_curve(index: int64): null | Curve
        
        /** Sets the gravity amount of the bone chain. This value is not an acceleration, but a constant velocity of movement in [method set_gravity_direction].  
         *  If [param gravity] is not `0`, the modified pose will not return to the original pose since it is always affected by gravity.  
         *  The value is scaled by [method set_gravity_damping_curve] and cached in each joint setting in the joint list.  
         */
        set_gravity(index: int64, gravity: float64): void
        
        /** Returns the gravity amount of the bone chain. */
        get_gravity(index: int64): float64
        
        /** Sets the gravity amount damping curve of the bone chain. */
        set_gravity_damping_curve(index: int64, curve: Curve): void
        
        /** Returns the gravity amount damping curve of the bone chain. */
        get_gravity_damping_curve(index: int64): null | Curve
        
        /** Sets the gravity direction of the bone chain. This value is internally normalized and then multiplied by [method set_gravity].  
         *  The value is cached in each joint setting in the joint list.  
         */
        set_gravity_direction(index: int64, gravity_direction: Vector3): void
        
        /** Returns the gravity direction of the bone chain. */
        get_gravity_direction(index: int64): Vector3
        
        /** Clears all settings. */
        clear_settings(): void
        
        /** If [param enabled] is `true`, the config can be edited individually for each joint. */
        set_individual_config(index: int64, enabled: boolean): void
        
        /** Returns `true` if the config can be edited individually for each joint. */
        is_config_individual(index: int64): boolean
        
        /** Returns the bone name at [param joint] in the bone chain's joint list. */
        get_joint_bone_name(index: int64, joint: int64): string
        
        /** Returns the bone index at [param joint] in the bone chain's joint list. */
        get_joint_bone(index: int64, joint: int64): int64
        
        /** Sets the rotation axis at [param joint] in the bone chain's joint list when [method is_config_individual] is `true`.  
         *  The axes are based on the [method Skeleton3D.get_bone_rest]'s space, if [param axis] is [constant SkeletonModifier3D.ROTATION_AXIS_CUSTOM], you can specify any axis.  
         *      
         *  **Note:** The rotation axis and the forward vector shouldn't be colinear to avoid unintended rotation since [SpringBoneSimulator3D] does not factor in twisting forces.  
         */
        set_joint_rotation_axis(index: int64, joint: int64, axis: SkeletonModifier3D.RotationAxis): void
        
        /** Returns the rotation axis at [param joint] in the bone chain's joint list. */
        get_joint_rotation_axis(index: int64, joint: int64): SkeletonModifier3D.RotationAxis
        
        /** Sets the rotation axis vector for the specified joint in the bone chain.  
         *  This vector is normalized by an internal process and represents the axis around which the bone chain can rotate.  
         *  If the vector length is `0`, it is considered synonymous with [constant SkeletonModifier3D.ROTATION_AXIS_ALL].  
         */
        set_joint_rotation_axis_vector(index: int64, joint: int64, vector: Vector3): void
        
        /** Returns the rotation axis vector for the specified joint in the bone chain. This vector represents the axis around which the joint can rotate. It is determined based on the rotation axis set for the joint.  
         *  If [method get_joint_rotation_axis] is [constant SkeletonModifier3D.ROTATION_AXIS_ALL], this method returns `Vector3(0, 0, 0)`.  
         */
        get_joint_rotation_axis_vector(index: int64, joint: int64): Vector3
        
        /** Sets the joint radius at [param joint] in the bone chain's joint list when [method is_config_individual] is `true`. */
        set_joint_radius(index: int64, joint: int64, radius: float64): void
        
        /** Returns the radius at [param joint] in the bone chain's joint list. */
        get_joint_radius(index: int64, joint: int64): float64
        
        /** Sets the stiffness force at [param joint] in the bone chain's joint list when [method is_config_individual] is `true`. */
        set_joint_stiffness(index: int64, joint: int64, stiffness: float64): void
        
        /** Returns the stiffness force at [param joint] in the bone chain's joint list. */
        get_joint_stiffness(index: int64, joint: int64): float64
        
        /** Sets the drag force at [param joint] in the bone chain's joint list when [method is_config_individual] is `true`. */
        set_joint_drag(index: int64, joint: int64, drag: float64): void
        
        /** Returns the drag force at [param joint] in the bone chain's joint list. */
        get_joint_drag(index: int64, joint: int64): float64
        
        /** Sets the gravity amount at [param joint] in the bone chain's joint list when [method is_config_individual] is `true`. */
        set_joint_gravity(index: int64, joint: int64, gravity: float64): void
        
        /** Returns the gravity amount at [param joint] in the bone chain's joint list. */
        get_joint_gravity(index: int64, joint: int64): float64
        
        /** Sets the gravity direction at [param joint] in the bone chain's joint list when [method is_config_individual] is `true`. */
        set_joint_gravity_direction(index: int64, joint: int64, gravity_direction: Vector3): void
        
        /** Returns the gravity direction at [param joint] in the bone chain's joint list. */
        get_joint_gravity_direction(index: int64, joint: int64): Vector3
        
        /** Returns the joint count of the bone chain's joint list. */
        get_joint_count(index: int64): int64
        
        /** If [param enabled] is `true`, all child [SpringBoneCollision3D]s are colliding and [method set_exclude_collision_path] is enabled as an exclusion list at [param index] in the settings.  
         *  If [param enabled] is `false`, you need to manually register all valid collisions with [method set_collision_path].  
         */
        set_enable_all_child_collisions(index: int64, enabled: boolean): void
        
        /** Returns `true` if all child [SpringBoneCollision3D]s are contained in the collision list at [param index] in the settings. */
        are_all_child_collisions_enabled(index: int64): boolean
        
        /** Sets the node path of the [SpringBoneCollision3D] at [param collision] in the bone chain's exclude collision list when [method are_all_child_collisions_enabled] is `true`. */
        set_exclude_collision_path(index: int64, collision: int64, node_path: NodePath | string): void
        
        /** Returns the node path of the [SpringBoneCollision3D] at [param collision] in the bone chain's exclude collision list when [method are_all_child_collisions_enabled] is `true`. */
        get_exclude_collision_path(index: int64, collision: int64): NodePath
        
        /** Sets the number of exclude collisions in the exclude collision list at [param index] in the settings when [method are_all_child_collisions_enabled] is `true`. */
        set_exclude_collision_count(index: int64, count: int64): void
        
        /** Returns the exclude collision count of the bone chain's exclude collision list when [method are_all_child_collisions_enabled] is `true`. */
        get_exclude_collision_count(index: int64): int64
        
        /** Clears all exclude collisions from the collision list at [param index] in the settings when [method are_all_child_collisions_enabled] is `true`. */
        clear_exclude_collisions(index: int64): void
        
        /** Sets the node path of the [SpringBoneCollision3D] at [param collision] in the bone chain's collision list when [method are_all_child_collisions_enabled] is `false`. */
        set_collision_path(index: int64, collision: int64, node_path: NodePath | string): void
        
        /** Returns the node path of the [SpringBoneCollision3D] at [param collision] in the bone chain's collision list when [method are_all_child_collisions_enabled] is `false`. */
        get_collision_path(index: int64, collision: int64): NodePath
        
        /** Sets the number of collisions in the collision list at [param index] in the settings when [method are_all_child_collisions_enabled] is `false`. */
        set_collision_count(index: int64, count: int64): void
        
        /** Returns the collision count of the bone chain's collision list when [method are_all_child_collisions_enabled] is `false`. */
        get_collision_count(index: int64): int64
        
        /** Clears all collisions from the collision list at [param index] in the settings when [method are_all_child_collisions_enabled] is `false`. */
        clear_collisions(index: int64): void
        
        /** Resets a simulating state with respect to the current bone pose.  
         *  It is useful to prevent the simulation result getting violent. For example, calling this immediately after a call to [method AnimationPlayer.play] without a fading, or within the previous [signal SkeletonModifier3D.modification_processed] signal if it's condition changes significantly.  
         */
        reset(): void
        
        /** The constant force that always affected bones. It is equal to the result when the parent [Skeleton3D] moves at this speed in the opposite direction.  
         *  This is useful for effects such as wind and anti-gravity.  
         */
        get external_force(): Vector3
        set external_force(value: Vector3)
        
        /** If `true`, the solver retrieves the bone axis from the bone pose every frame.  
         *  If `false`, the solver retrieves the bone axis from the bone rest and caches it, which increases performance slightly, but position changes in the bone pose made before processing this [SpringBoneSimulator3D] are ignored.  
         */
        get mutable_bone_axes(): boolean
        set mutable_bone_axes(value: boolean)
        
        /** The number of settings. */
        get setting_count(): int64
        set setting_count(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpringBoneSimulator3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSprite2D extends __NameMapNode2D {
    }
    /** General-purpose sprite node.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_sprite2d.html  
     */
    class Sprite2D<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** Returns `true` if the pixel at the given position is opaque, `false` otherwise. Also returns `false` if the given position is out of bounds or this sprite's [member texture] is `null`. [param pos] is in local coordinates. */
        is_pixel_opaque(pos: Vector2): boolean
        
        /** Returns a [Rect2] representing the Sprite2D's boundary in local coordinates.  
         *  **Example:** Detect if the Sprite2D was clicked:  
         *    
         */
        get_rect(): Rect2
        
        /** [Texture2D] object to draw. */
        get texture(): null | Texture2D
        set texture(value: null | Texture2D)
        
        /** If `true`, texture is centered.  
         *      
         *  **Note:** For games with a pixel art aesthetic, textures may appear deformed when centered. This is caused by their position being between pixels. To prevent this, set this property to `false`, or consider enabling [member ProjectSettings.rendering/2d/snap/snap_2d_vertices_to_pixel] and [member ProjectSettings.rendering/2d/snap/snap_2d_transforms_to_pixel].  
         */
        get centered(): boolean
        set centered(value: boolean)
        
        /** The texture's drawing offset.  
         *      
         *  **Note:** When you increase [member offset].y in Sprite2D, the sprite moves downward on screen (i.e., +Y is down).  
         */
        get offset(): Vector2
        set offset(value: Vector2)
        
        /** If `true`, texture is flipped horizontally. */
        get flip_h(): boolean
        set flip_h(value: boolean)
        
        /** If `true`, texture is flipped vertically. */
        get flip_v(): boolean
        set flip_v(value: boolean)
        
        /** The number of columns in the sprite sheet. When this property is changed, [member frame] is adjusted so that the same visual frame is maintained (same row and column). If that's impossible, [member frame] is reset to `0`. */
        get hframes(): int64
        set hframes(value: int64)
        
        /** The number of rows in the sprite sheet. When this property is changed, [member frame] is adjusted so that the same visual frame is maintained (same row and column). If that's impossible, [member frame] is reset to `0`. */
        get vframes(): int64
        set vframes(value: int64)
        
        /** Current frame to display from sprite sheet. [member hframes] or [member vframes] must be greater than 1. This property is automatically adjusted when [member hframes] or [member vframes] are changed to keep pointing to the same visual frame (same column and row). If that's impossible, this value is reset to `0`. */
        get frame(): int64
        set frame(value: int64)
        
        /** Coordinates of the frame to display from sprite sheet. This is as an alias for the [member frame] property. [member hframes] or [member vframes] must be greater than 1. */
        get frame_coords(): Vector2i
        set frame_coords(value: Vector2i)
        
        /** If `true`, texture is cut from a larger atlas texture. See [member region_rect].  
         *      
         *  **Note:** When using a custom [Shader] on a [Sprite2D], the `UV` shader built-in will refer to the entire texture space. Use the `REGION_RECT` built-in to get the currently visible region defined in [member region_rect] instead. See [url=https://docs.godotengine.org/en/4.6/tutorials/shaders/shader_reference/canvas_item_shader.html]CanvasItem shaders[/url] for details.  
         */
        get region_enabled(): boolean
        set region_enabled(value: boolean)
        
        /** The region of the atlas texture to display. [member region_enabled] must be `true`. */
        get region_rect(): Rect2
        set region_rect(value: Rect2)
        
        /** If `true`, the area outside of the [member region_rect] is clipped to avoid bleeding of the surrounding texture pixels. [member region_enabled] must be `true`. */
        get region_filter_clip_enabled(): boolean
        set region_filter_clip_enabled(value: boolean)
        
        /** Emitted when the [member frame] changes. */
        readonly frame_changed: Signal<() => void>
        
        /** Emitted when the [member texture] changes. */
        readonly texture_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSprite2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSprite3D extends __NameMapSpriteBase3D {
    }
    /** 2D sprite node in a 3D world.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_sprite3d.html  
     */
    class Sprite3D<Map extends NodePathMap = any> extends SpriteBase3D<Map> {
        constructor(identifier?: any)
        /** [Texture2D] object to draw. If [member GeometryInstance3D.material_override] is used, this will be overridden. The size information is still used. */
        get texture(): null | Texture2D
        set texture(value: null | Texture2D)
        
        /** The number of columns in the sprite sheet. When this property is changed, [member frame] is adjusted so that the same visual frame is maintained (same row and column). If that's impossible, [member frame] is reset to `0`. */
        get hframes(): int64
        set hframes(value: int64)
        
        /** The number of rows in the sprite sheet. When this property is changed, [member frame] is adjusted so that the same visual frame is maintained (same row and column). If that's impossible, [member frame] is reset to `0`. */
        get vframes(): int64
        set vframes(value: int64)
        
        /** Current frame to display from sprite sheet. [member hframes] or [member vframes] must be greater than 1. This property is automatically adjusted when [member hframes] or [member vframes] are changed to keep pointing to the same visual frame (same column and row). If that's impossible, this value is reset to `0`. */
        get frame(): int64
        set frame(value: int64)
        
        /** Coordinates of the frame to display from sprite sheet. This is as an alias for the [member frame] property. [member hframes] or [member vframes] must be greater than 1. */
        get frame_coords(): Vector2i
        set frame_coords(value: Vector2i)
        
        /** If `true`, the sprite will use [member region_rect] and display only the specified part of its texture. */
        get region_enabled(): boolean
        set region_enabled(value: boolean)
        
        /** The region of the atlas texture to display. [member region_enabled] must be `true`. */
        get region_rect(): Rect2
        set region_rect(value: Rect2)
        
        /** Emitted when the [member frame] changes. */
        readonly frame_changed: Signal<() => void>
        
        /** Emitted when the [member texture] changes. */
        readonly texture_changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSprite3D;
    }
    namespace SpriteBase3D {
        enum DrawFlags {
            /** If set, the texture's transparency and the opacity are used to make those parts of the sprite invisible. */
            FLAG_TRANSPARENT = 0,
            
            /** If set, lights in the environment affect the sprite. */
            FLAG_SHADED = 1,
            
            /** If set, texture can be seen from the back as well. If not, the texture is invisible when looking at it from behind. */
            FLAG_DOUBLE_SIDED = 2,
            
            /** Disables the depth test, so this object is drawn on top of all others. However, objects drawn after it in the draw order may cover it. */
            FLAG_DISABLE_DEPTH_TEST = 3,
            
            /** Label is scaled by depth so that it always appears the same size on screen. */
            FLAG_FIXED_SIZE = 4,
            
            /** Represents the size of the [enum DrawFlags] enum. */
            FLAG_MAX = 5,
        }
        enum AlphaCutMode {
            /** This mode performs standard alpha blending. It can display translucent areas, but transparency sorting issues may be visible when multiple transparent materials are overlapping. */
            ALPHA_CUT_DISABLED = 0,
            
            /** This mode only allows fully transparent or fully opaque pixels. Harsh edges will be visible unless some form of screen-space antialiasing is enabled (see [member ProjectSettings.rendering/anti_aliasing/quality/screen_space_aa]). On the bright side, this mode doesn't suffer from transparency sorting issues when multiple transparent materials are overlapping. This mode is also known as  *alpha testing*  or  *1-bit transparency* . */
            ALPHA_CUT_DISCARD = 1,
            
            /** This mode draws fully opaque pixels in the depth prepass. This is slower than [constant ALPHA_CUT_DISABLED] or [constant ALPHA_CUT_DISCARD], but it allows displaying translucent areas and smooth edges while using proper sorting. */
            ALPHA_CUT_OPAQUE_PREPASS = 2,
            
            /** This mode draws cuts off all values below a spatially-deterministic threshold, the rest will remain opaque. */
            ALPHA_CUT_HASH = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpriteBase3D extends __NameMapGeometryInstance3D {
    }
    /** 2D sprite node in 3D environment.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_spritebase3d.html  
     */
    class SpriteBase3D<Map extends NodePathMap = any> extends GeometryInstance3D<Map> {
        constructor(identifier?: any)
        /** If `true`, the specified flag will be enabled. */
        set_draw_flag(flag: SpriteBase3D.DrawFlags, enabled: boolean): void
        
        /** Returns the value of the specified flag. */
        get_draw_flag(flag: SpriteBase3D.DrawFlags): boolean
        
        /** Returns the rectangle representing this sprite. */
        get_item_rect(): Rect2
        
        /** Returns a [TriangleMesh] with the sprite's vertices following its current configuration (such as its [member axis] and [member pixel_size]). */
        generate_triangle_mesh(): null | TriangleMesh
        
        /** If `true`, texture will be centered. */
        get centered(): boolean
        set centered(value: boolean)
        
        /** The texture's drawing offset.  
         *      
         *  **Note:** When you increase [member offset].y in Sprite3D, the sprite moves upward in world space (i.e., +Y is up).  
         */
        get offset(): Vector2
        set offset(value: Vector2)
        
        /** If `true`, texture is flipped horizontally. */
        get flip_h(): boolean
        set flip_h(value: boolean)
        
        /** If `true`, texture is flipped vertically. */
        get flip_v(): boolean
        set flip_v(value: boolean)
        
        /** A color value used to  *multiply*  the texture's colors. Can be used for mood-coloring or to simulate the color of ambient light.  
         *      
         *  **Note:** Unlike [member CanvasItem.modulate] for 2D, colors with values above `1.0` (overbright) are not supported.  
         *      
         *  **Note:** If a [member GeometryInstance3D.material_override] is defined on the [SpriteBase3D], the material override must be configured to take vertex colors into account for albedo. Otherwise, the color defined in [member modulate] will be ignored. For a [BaseMaterial3D], [member BaseMaterial3D.vertex_color_use_as_albedo] must be `true`. For a [ShaderMaterial], `ALBEDO *= COLOR.rgb;` must be inserted in the shader's `fragment()` function.  
         */
        get modulate(): Color
        set modulate(value: Color)
        
        /** The size of one pixel's width on the sprite to scale it in 3D. */
        get pixel_size(): float64
        set pixel_size(value: float64)
        
        /** The direction in which the front of the texture faces. */
        get axis(): int64
        set axis(value: int64)
        
        /** The billboard mode to use for the sprite.  
         *      
         *  **Note:** When billboarding is enabled and the material also casts shadows, billboards will face **the** camera in the scene when rendering shadows. In scenes with multiple cameras, the intended shadow cannot be determined and this will result in undefined behavior. See [url=https://github.com/godotengine/godot/pull/72638]GitHub Pull Request #72638[/url] for details.  
         */
        get billboard(): int64
        set billboard(value: int64)
        
        /** If `true`, the texture's transparency and the opacity are used to make those parts of the sprite invisible. */
        get transparent(): boolean
        set transparent(value: boolean)
        
        /** If `true`, the [Light3D] in the [Environment] has effects on the sprite. */
        get shaded(): boolean
        set shaded(value: boolean)
        
        /** If `true`, texture can be seen from the back as well, if `false`, it is invisible when looking at it from behind. */
        get double_sided(): boolean
        set double_sided(value: boolean)
        
        /** If `true`, depth testing is disabled and the object will be drawn in render order. */
        get no_depth_test(): boolean
        set no_depth_test(value: boolean)
        
        /** If `true`, the texture is rendered at the same size regardless of distance. The texture's size on screen is the same as if the camera was `1.0` units away from the texture's origin, regardless of the actual distance from the camera. The [Camera3D]'s field of view (or [member Camera3D.size] when in orthogonal/frustum mode) still affects the size the sprite is drawn at. */
        get fixed_size(): boolean
        set fixed_size(value: boolean)
        
        /** The alpha cutting mode to use for the sprite. */
        get alpha_cut(): int64
        set alpha_cut(value: int64)
        
        /** Threshold at which the alpha scissor will discard values. */
        get alpha_scissor_threshold(): float64
        set alpha_scissor_threshold(value: float64)
        
        /** The hashing scale for Alpha Hash. Recommended values between `0` and `2`. */
        get alpha_hash_scale(): float64
        set alpha_hash_scale(value: float64)
        
        /** The type of alpha antialiasing to apply. */
        get alpha_antialiasing_mode(): int64
        set alpha_antialiasing_mode(value: int64)
        
        /** Threshold at which antialiasing will be applied on the alpha channel. */
        get alpha_antialiasing_edge(): float64
        set alpha_antialiasing_edge(value: float64)
        
        /** Filter flags for the texture.  
         *      
         *  **Note:** Linear filtering may cause artifacts around the edges, which are especially noticeable on opaque textures. To prevent this, use textures with transparent or identical colors around the edges.  
         */
        get texture_filter(): int64
        set texture_filter(value: int64)
        
        /** Sets the render priority for the sprite. Higher priority objects will be sorted in front of lower priority objects.  
         *      
         *  **Note:** This only applies if [member alpha_cut] is set to [constant ALPHA_CUT_DISABLED] (default value).  
         *      
         *  **Note:** This only applies to sorting of transparent objects. This will not impact how transparent objects are sorted relative to opaque objects. This is because opaque objects are not sorted, while transparent objects are sorted from back to front (subject to priority).  
         */
        get render_priority(): int64
        set render_priority(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpriteBase3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSpriteFrames extends __NameMapResource {
    }
    /** Sprite frame library for AnimatedSprite2D and AnimatedSprite3D.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_spriteframes.html  
     */
    class SpriteFrames extends Resource {
        constructor(identifier?: any)
        /** Adds a new [param anim] animation to the library. */
        add_animation(anim: StringName): void
        
        /** Returns `true` if the [param anim] animation exists. */
        has_animation(anim: StringName): boolean
        
        /** Duplicates the animation [param anim_from] to a new animation named [param anim_to]. Fails if [param anim_to] already exists, or if [param anim_from] does not exist. */
        duplicate_animation(anim_from: StringName, anim_to: StringName): void
        
        /** Removes the [param anim] animation. */
        remove_animation(anim: StringName): void
        
        /** Changes the [param anim] animation's name to [param newname]. */
        rename_animation(anim: StringName, newname: StringName): void
        
        /** Returns an array containing the names associated to each animation. Values are placed in alphabetical order. */
        get_animation_names(): PackedStringArray
        
        /** Sets the speed for the [param anim] animation in frames per second. */
        set_animation_speed(anim: StringName, fps: float64): void
        
        /** Returns the speed in frames per second for the [param anim] animation. */
        get_animation_speed(anim: StringName): float64
        
        /** If [param loop] is `true`, the [param anim] animation will loop when it reaches the end, or the start if it is played in reverse. */
        set_animation_loop(anim: StringName, loop: boolean): void
        
        /** Returns `true` if the given animation is configured to loop when it finishes playing. Otherwise, returns `false`. */
        get_animation_loop(anim: StringName): boolean
        
        /** Adds a frame to the [param anim] animation. If [param at_position] is `-1`, the frame will be added to the end of the animation. [param duration] specifies the relative duration, see [method get_frame_duration] for details. */
        add_frame(anim: StringName, texture: Texture2D, duration?: float64 /* = 1 */, at_position?: int64 /* = -1 */): void
        
        /** Sets the [param texture] and the [param duration] of the frame [param idx] in the [param anim] animation. [param duration] specifies the relative duration, see [method get_frame_duration] for details. */
        set_frame(anim: StringName, idx: int64, texture: Texture2D, duration?: float64 /* = 1 */): void
        
        /** Removes the [param anim] animation's frame [param idx]. */
        remove_frame(anim: StringName, idx: int64): void
        
        /** Returns the number of frames for the [param anim] animation. */
        get_frame_count(anim: StringName): int64
        
        /** Returns the texture of the frame [param idx] in the [param anim] animation. */
        get_frame_texture(anim: StringName, idx: int64): null | Texture2D
        
        /** Returns a relative duration of the frame [param idx] in the [param anim] animation (defaults to `1.0`). For example, a frame with a duration of `2.0` is displayed twice as long as a frame with a duration of `1.0`. You can calculate the absolute duration (in seconds) of a frame using the following formula:  
         *    
         *  In this example, `playing_speed` refers to either [method AnimatedSprite2D.get_playing_speed] or [method AnimatedSprite3D.get_playing_speed].  
         */
        get_frame_duration(anim: StringName, idx: int64): float64
        
        /** Removes all frames from the [param anim] animation. */
        clear(anim: StringName): void
        
        /** Removes all animations. An empty `default` animation will be created. */
        clear_all(): void
        get animations(): GArray
        set animations(value: GArray)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSpriteFrames;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStandardMaterial3D extends __NameMapBaseMaterial3D {
    }
    /** A PBR (Physically Based Rendering) material to be used on 3D objects.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_standardmaterial3d.html  
     */
    class StandardMaterial3D extends BaseMaterial3D {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStandardMaterial3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStaticBody2D extends __NameMapPhysicsBody2D {
    }
    /** A 2D physics body that can't be moved by external forces. When moved manually, it doesn't affect other bodies in its path.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_staticbody2d.html  
     */
    class StaticBody2D<Map extends NodePathMap = any> extends PhysicsBody2D<Map> {
        constructor(identifier?: any)
        /** The physics material override for the body.  
         *  If a material is assigned to this property, it will be used instead of any other physics material, such as an inherited one.  
         */
        get physics_material_override(): null | PhysicsMaterial
        set physics_material_override(value: null | PhysicsMaterial)
        
        /** The body's constant linear velocity. This does not move the body, but affects touching bodies, as if it were moving. */
        get constant_linear_velocity(): Vector2
        set constant_linear_velocity(value: Vector2)
        
        /** The body's constant angular velocity. This does not rotate the body, but affects touching bodies, as if it were rotating. */
        get constant_angular_velocity(): float64
        set constant_angular_velocity(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStaticBody2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStaticBody3D extends __NameMapPhysicsBody3D {
    }
    /** A 3D physics body that can't be moved by external forces. When moved manually, it doesn't affect other bodies in its path.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_staticbody3d.html  
     */
    class StaticBody3D<Map extends NodePathMap = any> extends PhysicsBody3D<Map> {
        constructor(identifier?: any)
        /** The physics material override for the body.  
         *  If a material is assigned to this property, it will be used instead of any other physics material, such as an inherited one.  
         */
        get physics_material_override(): null | PhysicsMaterial
        set physics_material_override(value: null | PhysicsMaterial)
        
        /** The body's constant linear velocity. This does not move the body, but affects touching bodies, as if it were moving. */
        get constant_linear_velocity(): Vector3
        set constant_linear_velocity(value: Vector3)
        
        /** The body's constant angular velocity. This does not rotate the body, but affects touching bodies, as if it were rotating. */
        get constant_angular_velocity(): Vector3
        set constant_angular_velocity(value: Vector3)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStaticBody3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStatusIndicator extends __NameMapNode {
    }
    /** Application status indicator (aka notification area icon).  
     *      
     *  **Note:** Status indicator is implemented on macOS and Windows.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_statusindicator.html  
     */
    class StatusIndicator<Map extends NodePathMap = any> extends Node<Map> {
        constructor(identifier?: any)
        /** Returns the status indicator rectangle in screen coordinates. If this status indicator is not visible, returns an empty [Rect2]. */
        get_rect(): Rect2
        
        /** Status indicator tooltip. */
        get tooltip(): string
        set tooltip(value: string)
        
        /** Status indicator icon. */
        get icon(): null | Texture2D
        set icon(value: null | Texture2D)
        
        /** Status indicator native popup menu. If this is set, the [signal pressed] signal is not emitted.  
         *      
         *  **Note:** Native popup is only supported if [NativeMenu] supports [constant NativeMenu.FEATURE_POPUP_MENU] feature.  
         */
        get menu(): NodePath
        set menu(value: NodePath | string)
        
        /** If `true`, the status indicator is visible. */
        get visible(): boolean
        set visible(value: boolean)
        
        /** Emitted when the status indicator is pressed. */
        readonly pressed: Signal<(mouse_button: int64, mouse_position: Vector2i) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStatusIndicator;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeer extends __NameMapRefCounted {
    }
    /** Abstract base class for interacting with streams.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeer.html  
     */
    class StreamPeer extends RefCounted {
        constructor(identifier?: any)
        /** Sends a chunk of data through the connection, blocking if necessary until the data is done sending. This function returns an [enum Error] code. */
        put_data(data: PackedByteArray | byte[] | ArrayBuffer): Error
        
        /** Sends a chunk of data through the connection. If all the data could not be sent at once, only part of it will. This function returns two values, an [enum Error] code and an integer, describing how much data was actually sent. */
        put_partial_data(data: PackedByteArray | byte[] | ArrayBuffer): GArray
        
        /** Returns a chunk data with the received bytes, as an [Array] containing two elements: an [enum Error] constant and a [PackedByteArray]. [param bytes] is the number of bytes to be received. If not enough bytes are available, the function will block until the desired amount is received. */
        get_data(bytes: int64): GArray
        
        /** Returns a chunk data with the received bytes, as an [Array] containing two elements: an [enum Error] constant and a [PackedByteArray]. [param bytes] is the number of bytes to be received. If not enough bytes are available, the function will return how many were actually received. */
        get_partial_data(bytes: int64): GArray
        
        /** Returns the number of bytes this [StreamPeer] has available. */
        get_available_bytes(): int64
        
        /** Puts a signed byte into the stream. */
        put_8(value: int64): void
        
        /** Puts an unsigned byte into the stream. */
        put_u8(value: int64): void
        
        /** Puts a signed 16-bit value into the stream. */
        put_16(value: int64): void
        
        /** Puts an unsigned 16-bit value into the stream. */
        put_u16(value: int64): void
        
        /** Puts a signed 32-bit value into the stream. */
        put_32(value: int64): void
        
        /** Puts an unsigned 32-bit value into the stream. */
        put_u32(value: int64): void
        
        /** Puts a signed 64-bit value into the stream. */
        put_64(value: int64): void
        
        /** Puts an unsigned 64-bit value into the stream. */
        put_u64(value: int64): void
        
        /** Puts a half-precision float into the stream. */
        put_half(value: float64): void
        
        /** Puts a single-precision float into the stream. */
        put_float(value: float64): void
        
        /** Puts a double-precision float into the stream. */
        put_double(value: float64): void
        
        /** Puts a zero-terminated ASCII string into the stream prepended by a 32-bit unsigned integer representing its size.  
         *      
         *  **Note:** To put an ASCII string without prepending its size, you can use [method put_data]:  
         *    
         */
        put_string(value: string): void
        
        /** Puts a zero-terminated UTF-8 string into the stream prepended by a 32 bits unsigned integer representing its size.  
         *      
         *  **Note:** To put a UTF-8 string without prepending its size, you can use [method put_data]:  
         *    
         */
        put_utf8_string(value: string): void
        
        /** Puts a Variant into the stream. If [param full_objects] is `true` encoding objects is allowed (and can potentially include code).  
         *  Internally, this uses the same encoding mechanism as the [method @GlobalScope.var_to_bytes] method.  
         */
        put_var(value: any, full_objects?: boolean /* = false */): void
        
        /** Gets a signed byte from the stream. */
        get_8(): int64
        
        /** Gets an unsigned byte from the stream. */
        get_u8(): int64
        
        /** Gets a signed 16-bit value from the stream. */
        get_16(): int64
        
        /** Gets an unsigned 16-bit value from the stream. */
        get_u16(): int64
        
        /** Gets a signed 32-bit value from the stream. */
        get_32(): int64
        
        /** Gets an unsigned 32-bit value from the stream. */
        get_u32(): int64
        
        /** Gets a signed 64-bit value from the stream. */
        get_64(): int64
        
        /** Gets an unsigned 64-bit value from the stream. */
        get_u64(): int64
        
        /** Gets a half-precision float from the stream. */
        get_half(): float64
        
        /** Gets a single-precision float from the stream. */
        get_float(): float64
        
        /** Gets a double-precision float from the stream. */
        get_double(): float64
        
        /** Gets an ASCII string with byte-length [param bytes] from the stream. If [param bytes] is negative (default) the length will be read from the stream using the reverse process of [method put_string]. */
        get_string(bytes?: int64 /* = -1 */): string
        
        /** Gets a UTF-8 string with byte-length [param bytes] from the stream (this decodes the string sent as UTF-8). If [param bytes] is negative (default) the length will be read from the stream using the reverse process of [method put_utf8_string]. */
        get_utf8_string(bytes?: int64 /* = -1 */): string
        
        /** Gets a Variant from the stream. If [param allow_objects] is `true`, decoding objects is allowed.  
         *  Internally, this uses the same decoding mechanism as the [method @GlobalScope.bytes_to_var] method.  
         *  **Warning:** Deserialized objects can contain code which gets executed. Do not use this option if the serialized object comes from untrusted sources to avoid potential security threats such as remote code execution.  
         */
        get_var(allow_objects?: boolean /* = false */): any
        
        /** If `true`, this [StreamPeer] will using big-endian format for encoding and decoding. */
        get big_endian(): boolean
        set big_endian(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerBuffer extends __NameMapStreamPeer {
    }
    /** A stream peer used to handle binary data streams.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeerbuffer.html  
     */
    class StreamPeerBuffer extends StreamPeer {
        constructor(identifier?: any)
        /** Moves the cursor to the specified position. [param position] must be a valid index of [member data_array]. */
        seek(position: int64): void
        
        /** Returns the size of [member data_array]. */
        get_size(): int64
        
        /** Returns the current cursor position. */
        get_position(): int64
        
        /** Resizes the [member data_array]. This  *doesn't*  update the cursor. */
        resize(size: int64): void
        
        /** Clears the [member data_array] and resets the cursor. */
        clear(): void
        
        /** Returns a new [StreamPeerBuffer] with the same [member data_array] content. */
        duplicate(): null | StreamPeerBuffer
        
        /** The underlying data buffer. Setting this value resets the cursor. */
        get data_array(): PackedByteArray
        set data_array(value: PackedByteArray | byte[] | ArrayBuffer)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerBuffer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerExtension extends __NameMapStreamPeer {
    }
    /** @link https://docs.godotengine.org/en/4.6/classes/class_streampeerextension.html */
    class StreamPeerExtension extends StreamPeer {
        constructor(identifier?: any)
        /* gdvirtual */ _get_data(r_buffer: int64, r_bytes: int64, r_received: int64): Error
        /* gdvirtual */ _get_partial_data(r_buffer: int64, r_bytes: int64, r_received: int64): Error
        /* gdvirtual */ _put_data(p_data: int64, p_bytes: int64, r_sent: int64): Error
        /* gdvirtual */ _put_partial_data(p_data: int64, p_bytes: int64, r_sent: int64): Error
        /* gdvirtual */ _get_available_bytes(): int64
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerGZIP extends __NameMapStreamPeer {
    }
    /** A stream peer that handles GZIP and deflate compression/decompression.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeergzip.html  
     */
    class StreamPeerGZIP extends StreamPeer {
        constructor(identifier?: any)
        /** Start the stream in compression mode with the given [param buffer_size], if [param use_deflate] is `true` uses deflate instead of GZIP. */
        start_compression(use_deflate?: boolean /* = false */, buffer_size?: int64 /* = 65535 */): Error
        
        /** Start the stream in decompression mode with the given [param buffer_size], if [param use_deflate] is `true` uses deflate instead of GZIP. */
        start_decompression(use_deflate?: boolean /* = false */, buffer_size?: int64 /* = 65535 */): Error
        
        /** Finalizes the stream, compressing any buffered chunk left.  
         *  You must call it only when you are compressing.  
         */
        finish(): Error
        
        /** Clears this stream, resetting the internal state. */
        clear(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerGZIP;
    }
    namespace StreamPeerSocket {
        enum Status {
            /** The initial status of the [StreamPeerSocket]. This is also the status after disconnecting. */
            STATUS_NONE = 0,
            
            /** A status representing a [StreamPeerSocket] that is connecting to a host. */
            STATUS_CONNECTING = 1,
            
            /** A status representing a [StreamPeerSocket] that is connected to a host. */
            STATUS_CONNECTED = 2,
            
            /** A status representing a [StreamPeerSocket] in error state. */
            STATUS_ERROR = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerSocket extends __NameMapStreamPeer {
    }
    /** Abstract base class for interacting with socket streams.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeersocket.html  
     */
    class StreamPeerSocket extends StreamPeer {
        constructor(identifier?: any)
        /** Polls the socket, updating its state. See [method get_status]. */
        poll(): Error
        
        /** Returns the status of the connection. */
        get_status(): StreamPeerSocket.Status
        
        /** Disconnects from host. */
        disconnect_from_host(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerSocket;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerTCP extends __NameMapStreamPeerSocket {
    }
    /** A stream peer that handles TCP connections.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeertcp.html  
     */
    class StreamPeerTCP extends StreamPeerSocket {
        constructor(identifier?: any)
        /** Opens the TCP socket, and binds it to the specified local address.  
         *  This method is generally not needed, and only used to force the subsequent call to [method connect_to_host] to use the specified [param host] and [param port] as source address. This can be desired in some NAT punchthrough techniques, or when forcing the source network interface.  
         */
        bind(port: int64, host?: string /* = '*' */): Error
        
        /** Connects to the specified `host:port` pair. A hostname will be resolved if valid. Returns [constant OK] on success. */
        connect_to_host(host: string, port: int64): Error
        
        /** Returns the IP of this peer. */
        get_connected_host(): string
        
        /** Returns the port of this peer. */
        get_connected_port(): int64
        
        /** Returns the local port to which this peer is bound. */
        get_local_port(): int64
        
        /** If [param enabled] is `true`, packets will be sent immediately. If [param enabled] is `false` (the default), packet transfers will be delayed and combined using [url=https://en.wikipedia.org/wiki/Nagle%27s_algorithm]Nagle's algorithm[/url].  
         *      
         *  **Note:** It's recommended to leave this disabled for applications that send large packets or need to transfer a lot of data, as enabling this can decrease the total available bandwidth.  
         */
        set_no_delay(enabled: boolean): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerTCP;
    }
    namespace StreamPeerTLS {
        enum Status {
            /** A status representing a [StreamPeerTLS] that is disconnected. */
            STATUS_DISCONNECTED = 0,
            
            /** A status representing a [StreamPeerTLS] during handshaking. */
            STATUS_HANDSHAKING = 1,
            
            /** A status representing a [StreamPeerTLS] that is connected to a host. */
            STATUS_CONNECTED = 2,
            
            /** A status representing a [StreamPeerTLS] in error state. */
            STATUS_ERROR = 3,
            
            /** An error status that shows a mismatch in the TLS certificate domain presented by the host and the domain requested for validation. */
            STATUS_ERROR_HOSTNAME_MISMATCH = 4,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerTLS extends __NameMapStreamPeer {
    }
    /** A stream peer that handles TLS connections.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeertls.html  
     */
    class StreamPeerTLS extends StreamPeer {
        constructor(identifier?: any)
        /** Poll the connection to check for incoming bytes. Call this right before [method StreamPeer.get_available_bytes] for it to work properly. */
        poll(): void
        
        /** Accepts a peer connection as a server using the given [param server_options]. See [method TLSOptions.server]. */
        accept_stream(stream: StreamPeer, server_options: TLSOptions): Error
        
        /** Connects to a peer using an underlying [StreamPeer] [param stream] and verifying the remote certificate is correctly signed for the given [param common_name]. You can pass the optional [param client_options] parameter to customize the trusted certification authorities, or disable the common name verification. See [method TLSOptions.client] and [method TLSOptions.client_unsafe]. */
        connect_to_stream(stream: StreamPeer, common_name: string, client_options?: TLSOptions): Error
        
        /** Returns the status of the connection. */
        get_status(): StreamPeerTLS.Status
        
        /** Returns the underlying [StreamPeer] connection, used in [method accept_stream] or [method connect_to_stream]. */
        get_stream(): null | StreamPeer
        
        /** Disconnects from host. */
        disconnect_from_stream(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerTLS;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStreamPeerUDS extends __NameMapStreamPeerSocket {
    }
    /** A stream peer that handles UNIX Domain Socket (UDS) connections.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_streampeeruds.html  
     */
    class StreamPeerUDS extends StreamPeerSocket {
        constructor(identifier?: any)
        /** Opens the UDS socket, and binds it to the specified socket path.  
         *  This method is generally not needed, and only used to force the subsequent call to [method connect_to_host] to use the specified [param path] as the source address.  
         */
        bind(path: string): Error
        
        /** Connects to the specified UNIX Domain Socket path. Returns [constant OK] on success. */
        connect_to_host(path: string): Error
        
        /** Returns the socket path of this peer. */
        get_connected_path(): string
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStreamPeerUDS;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStyleBox extends __NameMapResource {
    }
    /** Abstract base class for defining stylized boxes for UI elements.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_stylebox.html  
     */
    class StyleBox extends Resource {
        constructor(identifier?: any)
        /* gdvirtual */ _draw(to_canvas_item: RID, rect: Rect2): void
        /* gdvirtual */ _get_draw_rect(rect: Rect2): Rect2
        
        /** Virtual method to be implemented by the user. Returns a custom minimum size that the stylebox must respect when drawing. By default [method get_minimum_size] only takes content margins into account. This method can be overridden to add another size restriction. A combination of the default behavior and the output of this method will be used, to account for both sizes. */
        /* gdvirtual */ _get_minimum_size(): Vector2
        /* gdvirtual */ _test_mask(point: Vector2, rect: Rect2): boolean
        
        /** Returns the minimum size that this stylebox can be shrunk to. */
        get_minimum_size(): Vector2
        
        /** Sets the default value of the specified [enum Side] to [param offset] pixels. */
        set_content_margin(margin: Side, offset: float64): void
        
        /** Sets the default margin to [param offset] pixels for all sides. */
        set_content_margin_all(offset: float64): void
        
        /** Returns the default margin of the specified [enum Side]. */
        get_content_margin(margin: Side): float64
        
        /** Returns the content margin offset for the specified [enum Side].  
         *  Positive values reduce size inwards, unlike [Control]'s margin values.  
         */
        get_margin(margin: Side): float64
        
        /** Returns the "offset" of a stylebox. This helper function returns a value equivalent to `Vector2(style.get_margin(MARGIN_LEFT), style.get_margin(MARGIN_TOP))`. */
        get_offset(): Vector2
        
        /** Draws this stylebox using a canvas item identified by the given [RID].  
         *  The [RID] value can either be the result of [method CanvasItem.get_canvas_item] called on an existing [CanvasItem]-derived node, or directly from creating a canvas item in the [RenderingServer] with [method RenderingServer.canvas_item_create].  
         */
        draw(canvas_item: RID, rect: Rect2): void
        
        /** Returns the [CanvasItem] that handles its [constant CanvasItem.NOTIFICATION_DRAW] or [method CanvasItem._draw] callback at this moment. */
        get_current_item_drawn(): null | CanvasItem
        
        /** Test a position in a rectangle, return whether it passes the mask test. */
        test_mask(point: Vector2, rect: Rect2): boolean
        
        /** The left margin for the contents of this style box. Increasing this value reduces the space available to the contents from the left.  
         *  Refer to [member content_margin_bottom] for extra considerations.  
         */
        get content_margin_left(): float64
        set content_margin_left(value: float64)
        
        /** The top margin for the contents of this style box. Increasing this value reduces the space available to the contents from the top.  
         *  Refer to [member content_margin_bottom] for extra considerations.  
         */
        get content_margin_top(): float64
        set content_margin_top(value: float64)
        
        /** The right margin for the contents of this style box. Increasing this value reduces the space available to the contents from the right.  
         *  Refer to [member content_margin_bottom] for extra considerations.  
         */
        get content_margin_right(): float64
        set content_margin_right(value: float64)
        
        /** The bottom margin for the contents of this style box. Increasing this value reduces the space available to the contents from the bottom.  
         *  If this value is negative, it is ignored and a child-specific margin is used instead. For example, for [StyleBoxFlat], the border thickness (if any) is used instead.  
         *  It is up to the code using this style box to decide what these contents are: for example, a [Button] respects this content margin for the textual contents of the button.  
         *  [method get_margin] should be used to fetch this value as consumer instead of reading these properties directly. This is because it correctly respects negative values and the fallback mentioned above.  
         */
        get content_margin_bottom(): float64
        set content_margin_bottom(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStyleBox;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStyleBoxEmpty extends __NameMapStyleBox {
    }
    /** An empty [StyleBox] (does not display anything).  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_styleboxempty.html  
     */
    class StyleBoxEmpty extends StyleBox {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStyleBoxEmpty;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStyleBoxFlat extends __NameMapStyleBox {
    }
    /** A customizable [StyleBox] that doesn't use a texture.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_styleboxflat.html  
     */
    class StyleBoxFlat extends StyleBox {
        constructor(identifier?: any)
        /** Sets the border width to [param width] pixels for all sides. */
        set_border_width_all(width: int64): void
        
        /** Returns the smallest border width out of all four borders. */
        get_border_width_min(): int64
        
        /** Sets the specified [enum Side]'s border width to [param width] pixels. */
        set_border_width(margin: Side, width: int64): void
        
        /** Returns the specified [enum Side]'s border width. */
        get_border_width(margin: Side): int64
        
        /** Sets the corner radius to [param radius] pixels for all corners. */
        set_corner_radius_all(radius: int64): void
        
        /** Sets the corner radius to [param radius] pixels for the given [param corner]. */
        set_corner_radius(corner: Corner, radius: int64): void
        
        /** Returns the given [param corner]'s radius. */
        get_corner_radius(corner: Corner): int64
        
        /** Sets the expand margin to [param size] pixels for the specified [enum Side]. */
        set_expand_margin(margin: Side, size: float64): void
        
        /** Sets the expand margin to [param size] pixels for all sides. */
        set_expand_margin_all(size: float64): void
        
        /** Returns the size of the specified [enum Side]'s expand margin. */
        get_expand_margin(margin: Side): float64
        
        /** The background color of the stylebox. */
        get bg_color(): Color
        set bg_color(value: Color)
        
        /** Toggles drawing of the inner part of the stylebox. */
        get draw_center(): boolean
        set draw_center(value: boolean)
        
        /** If set to a non-zero value on either axis, [member skew] distorts the StyleBox horizontally and/or vertically. This can be used for "futuristic"-style UIs. Positive values skew the StyleBox towards the right (X axis) and upwards (Y axis), while negative values skew the StyleBox towards the left (X axis) and downwards (Y axis).  
         *      
         *  **Note:** To ensure text does not touch the StyleBox's edges, consider increasing the [StyleBox]'s content margin (see [member StyleBox.content_margin_bottom]). It is preferable to increase the content margin instead of the expand margin (see [member expand_margin_bottom]), as increasing the expand margin does not increase the size of the clickable area for [Control]s.  
         */
        get skew(): Vector2
        set skew(value: Vector2)
        
        /** Border width for the left border. */
        get border_width_left(): int64
        set border_width_left(value: int64)
        
        /** Border width for the top border. */
        get border_width_top(): int64
        set border_width_top(value: int64)
        
        /** Border width for the right border. */
        get border_width_right(): int64
        set border_width_right(value: int64)
        
        /** Border width for the bottom border. */
        get border_width_bottom(): int64
        set border_width_bottom(value: int64)
        
        /** Sets the color of the border. */
        get border_color(): Color
        set border_color(value: Color)
        
        /** If `true`, the border will fade into the background color. */
        get border_blend(): boolean
        set border_blend(value: boolean)
        
        /** The top-left corner's radius. If `0`, the corner is not rounded. */
        get corner_radius_top_left(): int64
        set corner_radius_top_left(value: int64)
        
        /** The top-right corner's radius. If `0`, the corner is not rounded. */
        get corner_radius_top_right(): int64
        set corner_radius_top_right(value: int64)
        
        /** The bottom-right corner's radius. If `0`, the corner is not rounded. */
        get corner_radius_bottom_right(): int64
        set corner_radius_bottom_right(value: int64)
        
        /** The bottom-left corner's radius. If `0`, the corner is not rounded. */
        get corner_radius_bottom_left(): int64
        set corner_radius_bottom_left(value: int64)
        
        /** This sets the number of vertices used for each corner. Higher values result in rounder corners but take more processing power to compute. When choosing a value, you should take the corner radius ([method set_corner_radius_all]) into account.  
         *  For corner radii less than 10, `4` or `5` should be enough. For corner radii less than 30, values between `8` and `12` should be enough.  
         *  A corner detail of `1` will result in chamfered corners instead of rounded corners, which is useful for some artistic effects.  
         */
        get corner_detail(): int64
        set corner_detail(value: int64)
        
        /** Expands the stylebox outside of the control rect on the left edge. Useful in combination with [member border_width_left] to draw a border outside the control rect.  
         *      
         *  **Note:** Unlike [member StyleBox.content_margin_left], [member expand_margin_left] does  *not*  affect the size of the clickable area for [Control]s. This can negatively impact usability if used wrong, as the user may try to click an area of the StyleBox that cannot actually receive clicks.  
         */
        get expand_margin_left(): float64
        set expand_margin_left(value: float64)
        
        /** Expands the stylebox outside of the control rect on the top edge. Useful in combination with [member border_width_top] to draw a border outside the control rect.  
         *      
         *  **Note:** Unlike [member StyleBox.content_margin_top], [member expand_margin_top] does  *not*  affect the size of the clickable area for [Control]s. This can negatively impact usability if used wrong, as the user may try to click an area of the StyleBox that cannot actually receive clicks.  
         */
        get expand_margin_top(): float64
        set expand_margin_top(value: float64)
        
        /** Expands the stylebox outside of the control rect on the right edge. Useful in combination with [member border_width_right] to draw a border outside the control rect.  
         *      
         *  **Note:** Unlike [member StyleBox.content_margin_right], [member expand_margin_right] does  *not*  affect the size of the clickable area for [Control]s. This can negatively impact usability if used wrong, as the user may try to click an area of the StyleBox that cannot actually receive clicks.  
         */
        get expand_margin_right(): float64
        set expand_margin_right(value: float64)
        
        /** Expands the stylebox outside of the control rect on the bottom edge. Useful in combination with [member border_width_bottom] to draw a border outside the control rect.  
         *      
         *  **Note:** Unlike [member StyleBox.content_margin_bottom], [member expand_margin_bottom] does  *not*  affect the size of the clickable area for [Control]s. This can negatively impact usability if used wrong, as the user may try to click an area of the StyleBox that cannot actually receive clicks.  
         */
        get expand_margin_bottom(): float64
        set expand_margin_bottom(value: float64)
        
        /** The color of the shadow. This has no effect if [member shadow_size] is lower than 1. */
        get shadow_color(): Color
        set shadow_color(value: Color)
        
        /** The shadow size in pixels. */
        get shadow_size(): int64
        set shadow_size(value: int64)
        
        /** The shadow offset in pixels. Adjusts the position of the shadow relatively to the stylebox. */
        get shadow_offset(): Vector2
        set shadow_offset(value: Vector2)
        
        /** Antialiasing draws a small ring around the edges, which fades to transparency. As a result, edges look much smoother. This is only noticeable when using rounded corners or [member skew].  
         *      
         *  **Note:** When using beveled corners with 45-degree angles ([member corner_detail] = 1), it is recommended to set [member anti_aliasing] to `false` to ensure crisp visuals and avoid possible visual glitches.  
         */
        get anti_aliasing(): boolean
        set anti_aliasing(value: boolean)
        
        /** This changes the size of the antialiasing effect. `1.0` is recommended for an optimal result at 100% scale, identical to how rounded rectangles are rendered in web browsers and most vector drawing software.  
         *      
         *  **Note:** Higher values may produce a blur effect but can also create undesired artifacts on small boxes with large-radius corners.  
         */
        get anti_aliasing_size(): float64
        set anti_aliasing_size(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStyleBoxFlat;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStyleBoxLine extends __NameMapStyleBox {
    }
    /** A [StyleBox] that displays a single line of a given color and thickness.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_styleboxline.html  
     */
    class StyleBoxLine extends StyleBox {
        constructor(identifier?: any)
        /** The line's color. */
        get color(): Color
        set color(value: Color)
        
        /** The number of pixels the line will extend before the [StyleBoxLine]'s bounds. If set to a negative value, the line will begin inside the [StyleBoxLine]'s bounds. */
        get grow_begin(): float64
        set grow_begin(value: float64)
        
        /** The number of pixels the line will extend past the [StyleBoxLine]'s bounds. If set to a negative value, the line will end inside the [StyleBoxLine]'s bounds. */
        get grow_end(): float64
        set grow_end(value: float64)
        
        /** The line's thickness in pixels. */
        get thickness(): int64
        set thickness(value: int64)
        
        /** If `true`, the line will be vertical. If `false`, the line will be horizontal. */
        get vertical(): boolean
        set vertical(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStyleBoxLine;
    }
    namespace StyleBoxTexture {
        enum AxisStretchMode {
            /** Stretch the stylebox's texture. This results in visible distortion unless the texture size matches the stylebox's size perfectly. */
            AXIS_STRETCH_MODE_STRETCH = 0,
            
            /** Repeats the stylebox's texture to match the stylebox's size according to the nine-patch system. */
            AXIS_STRETCH_MODE_TILE = 1,
            
            /** Repeats the stylebox's texture to match the stylebox's size according to the nine-patch system. Unlike [constant AXIS_STRETCH_MODE_TILE], the texture may be slightly stretched to make the nine-patch texture tile seamlessly. */
            AXIS_STRETCH_MODE_TILE_FIT = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapStyleBoxTexture extends __NameMapStyleBox {
    }
    /** A texture-based nine-patch [StyleBox].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_styleboxtexture.html  
     */
    class StyleBoxTexture extends StyleBox {
        constructor(identifier?: any)
        /** Sets the margin to [param size] pixels for the specified [enum Side]. */
        set_texture_margin(margin: Side, size: float64): void
        
        /** Sets the margin to [param size] pixels for all sides. */
        set_texture_margin_all(size: float64): void
        
        /** Returns the margin size of the specified [enum Side]. */
        get_texture_margin(margin: Side): float64
        
        /** Sets the expand margin to [param size] pixels for the specified [enum Side]. */
        set_expand_margin(margin: Side, size: float64): void
        
        /** Sets the expand margin to [param size] pixels for all sides. */
        set_expand_margin_all(size: float64): void
        
        /** Returns the expand margin size of the specified [enum Side]. */
        get_expand_margin(margin: Side): float64
        
        /** The texture to use when drawing this style box. */
        get texture(): null | Texture2D
        set texture(value: null | Texture2D)
        
        /** Increases the left margin of the 3×3 texture box.  
         *  A higher value means more of the source texture is considered to be part of the left border of the 3×3 box.  
         *  This is also the value used as fallback for [member StyleBox.content_margin_left] if it is negative.  
         */
        get texture_margin_left(): float64
        set texture_margin_left(value: float64)
        
        /** Increases the top margin of the 3×3 texture box.  
         *  A higher value means more of the source texture is considered to be part of the top border of the 3×3 box.  
         *  This is also the value used as fallback for [member StyleBox.content_margin_top] if it is negative.  
         */
        get texture_margin_top(): float64
        set texture_margin_top(value: float64)
        
        /** Increases the right margin of the 3×3 texture box.  
         *  A higher value means more of the source texture is considered to be part of the right border of the 3×3 box.  
         *  This is also the value used as fallback for [member StyleBox.content_margin_right] if it is negative.  
         */
        get texture_margin_right(): float64
        set texture_margin_right(value: float64)
        
        /** Increases the bottom margin of the 3×3 texture box.  
         *  A higher value means more of the source texture is considered to be part of the bottom border of the 3×3 box.  
         *  This is also the value used as fallback for [member StyleBox.content_margin_bottom] if it is negative.  
         */
        get texture_margin_bottom(): float64
        set texture_margin_bottom(value: float64)
        
        /** Expands the left margin of this style box when drawing, causing it to be drawn larger than requested. */
        get expand_margin_left(): float64
        set expand_margin_left(value: float64)
        
        /** Expands the top margin of this style box when drawing, causing it to be drawn larger than requested. */
        get expand_margin_top(): float64
        set expand_margin_top(value: float64)
        
        /** Expands the right margin of this style box when drawing, causing it to be drawn larger than requested. */
        get expand_margin_right(): float64
        set expand_margin_right(value: float64)
        
        /** Expands the bottom margin of this style box when drawing, causing it to be drawn larger than requested. */
        get expand_margin_bottom(): float64
        set expand_margin_bottom(value: float64)
        
        /** Controls how the stylebox's texture will be stretched or tiled horizontally. */
        get axis_stretch_horizontal(): int64
        set axis_stretch_horizontal(value: int64)
        
        /** Controls how the stylebox's texture will be stretched or tiled vertically. */
        get axis_stretch_vertical(): int64
        set axis_stretch_vertical(value: int64)
        
        /** The region to use from the [member texture].  
         *  This is equivalent to first wrapping the [member texture] in an [AtlasTexture] with the same region.  
         *  If empty (`Rect2(0, 0, 0, 0)`), the whole [member texture] is used.  
         */
        get region_rect(): Rect2
        set region_rect(value: Rect2)
        
        /** Modulates the color of the texture when this style box is drawn. */
        get modulate_color(): Color
        set modulate_color(value: Color)
        
        /** If `true`, the nine-patch texture's center tile will be drawn. */
        get draw_center(): boolean
        set draw_center(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapStyleBoxTexture;
    }
    namespace SubViewport {
        enum ClearMode {
            /** Always clear the render target before drawing. */
            CLEAR_MODE_ALWAYS = 0,
            
            /** Never clear the render target. */
            CLEAR_MODE_NEVER = 1,
            
            /** Clear the render target on the next frame, then switch to [constant CLEAR_MODE_NEVER]. */
            CLEAR_MODE_ONCE = 2,
        }
        enum UpdateMode {
            /** Do not update the render target. */
            UPDATE_DISABLED = 0,
            
            /** Update the render target once, then switch to [constant UPDATE_DISABLED]. */
            UPDATE_ONCE = 1,
            
            /** Update the render target only when it is visible. This is the default value. */
            UPDATE_WHEN_VISIBLE = 2,
            
            /** Update the render target only when its parent is visible. */
            UPDATE_WHEN_PARENT_VISIBLE = 3,
            
            /** Always update the render target. */
            UPDATE_ALWAYS = 4,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSubViewport extends __NameMapViewport {
    }
    /** An interface to a game world that doesn't create a window or draw to the screen directly.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_subviewport.html  
     */
    class SubViewport<Map extends NodePathMap = any> extends Viewport<Map> {
        constructor(identifier?: any)
        /** The width and height of the sub-viewport. Must be set to a value greater than or equal to 2 pixels on both dimensions. Otherwise, nothing will be displayed.  
         *      
         *  **Note:** If the parent node is a [SubViewportContainer] and its [member SubViewportContainer.stretch] is `true`, the viewport size cannot be changed manually.  
         */
        get size(): Vector2i
        set size(value: Vector2i)
        
        /** The 2D size override of the sub-viewport. If either the width or height is `0`, the override is disabled. */
        get size_2d_override(): Vector2i
        set size_2d_override(value: Vector2i)
        
        /** If `true`, the 2D size override affects stretch as well. */
        get size_2d_override_stretch(): boolean
        set size_2d_override_stretch(value: boolean)
        
        /** The clear mode when the sub-viewport is used as a render target.  
         *      
         *  **Note:** This property is intended for 2D usage.  
         */
        get render_target_clear_mode(): int64
        set render_target_clear_mode(value: int64)
        
        /** The update mode when the sub-viewport is used as a render target. */
        get render_target_update_mode(): int64
        set render_target_update_mode(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSubViewport;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSubViewportContainer extends __NameMapContainer {
    }
    /** A container used for displaying the contents of a [SubViewport].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_subviewportcontainer.html  
     */
    class SubViewportContainer<Map extends NodePathMap = any> extends Container<Map> {
        constructor(identifier?: any)
        /** Virtual method to be implemented by the user. If it returns `true`, the [param event] is propagated to [SubViewport] children. Propagation doesn't happen if it returns `false`. If the function is not implemented, all events are propagated to SubViewports. */
        /* gdvirtual */ _propagate_input_event(event: InputEvent): boolean
        
        /** If `true`, the sub-viewport will be automatically resized to the control's size.  
         *      
         *  **Note:** If `true`, this will prohibit changing [member SubViewport.size] of its children manually.  
         */
        get stretch(): boolean
        set stretch(value: boolean)
        
        /** Divides the sub-viewport's effective resolution by this value while preserving its scale. This can be used to speed up rendering.  
         *  For example, a 1280×720 sub-viewport with [member stretch_shrink] set to `2` will be rendered at 640×360 while occupying the same size in the container.  
         *      
         *  **Note:** [member stretch] must be `true` for this property to work.  
         */
        get stretch_shrink(): int64
        set stretch_shrink(value: int64)
        
        /** Configure, if either the [SubViewportContainer] or alternatively the [Control] nodes of its [SubViewport] children should be available as targets of mouse-related functionalities, like identifying the drop target in drag-and-drop operations or cursor shape of hovered [Control] node.  
         *  If `false`, the [Control] nodes inside its [SubViewport] children are considered as targets.  
         *  If `true`, the [SubViewportContainer] itself will be considered as a target.  
         */
        get mouse_target(): boolean
        set mouse_target(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSubViewportContainer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSubtweenTweener extends __NameMapTweener {
    }
    /** Runs a [Tween] nested within another [Tween].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_subtweentweener.html  
     */
    class SubtweenTweener extends Tweener {
        constructor(identifier?: any)
        /** Sets the time in seconds after which the [SubtweenTweener] will start running the subtween. By default there's no delay. */
        set_delay(delay: float64): null | SubtweenTweener
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSubtweenTweener;
    }
    namespace SurfaceTool {
        enum CustomFormat {
            /** Limits range of data passed to [method set_custom] to unsigned normalized 0 to 1 stored in 8 bits per channel. See [constant Mesh.ARRAY_CUSTOM_RGBA8_UNORM]. */
            CUSTOM_RGBA8_UNORM = 0,
            
            /** Limits range of data passed to [method set_custom] to signed normalized -1 to 1 stored in 8 bits per channel. See [constant Mesh.ARRAY_CUSTOM_RGBA8_SNORM]. */
            CUSTOM_RGBA8_SNORM = 1,
            
            /** Stores data passed to [method set_custom] as half precision floats, and uses only red and green color channels. See [constant Mesh.ARRAY_CUSTOM_RG_HALF]. */
            CUSTOM_RG_HALF = 2,
            
            /** Stores data passed to [method set_custom] as half precision floats and uses all color channels. See [constant Mesh.ARRAY_CUSTOM_RGBA_HALF]. */
            CUSTOM_RGBA_HALF = 3,
            
            /** Stores data passed to [method set_custom] as full precision floats, and uses only red color channel. See [constant Mesh.ARRAY_CUSTOM_R_FLOAT]. */
            CUSTOM_R_FLOAT = 4,
            
            /** Stores data passed to [method set_custom] as full precision floats, and uses only red and green color channels. See [constant Mesh.ARRAY_CUSTOM_RG_FLOAT]. */
            CUSTOM_RG_FLOAT = 5,
            
            /** Stores data passed to [method set_custom] as full precision floats, and uses only red, green and blue color channels. See [constant Mesh.ARRAY_CUSTOM_RGB_FLOAT]. */
            CUSTOM_RGB_FLOAT = 6,
            
            /** Stores data passed to [method set_custom] as full precision floats, and uses all color channels. See [constant Mesh.ARRAY_CUSTOM_RGBA_FLOAT]. */
            CUSTOM_RGBA_FLOAT = 7,
            
            /** Used to indicate a disabled custom channel. */
            CUSTOM_MAX = 8,
        }
        enum SkinWeightCount {
            /** Each individual vertex can be influenced by only 4 bone weights. */
            SKIN_4_WEIGHTS = 0,
            
            /** Each individual vertex can be influenced by up to 8 bone weights. */
            SKIN_8_WEIGHTS = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSurfaceTool extends __NameMapRefCounted {
    }
    /** Helper tool to create geometry.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_surfacetool.html  
     */
    class SurfaceTool extends RefCounted {
        constructor(identifier?: any)
        /** Set to [constant SKIN_8_WEIGHTS] to indicate that up to 8 bone influences per vertex may be used.  
         *  By default, only 4 bone influences are used ([constant SKIN_4_WEIGHTS]).  
         *      
         *  **Note:** This function takes an enum, not the exact number of weights.  
         */
        set_skin_weight_count(count: SurfaceTool.SkinWeightCount): void
        
        /** By default, returns [constant SKIN_4_WEIGHTS] to indicate only 4 bone influences per vertex are used.  
         *  Returns [constant SKIN_8_WEIGHTS] if up to 8 influences are used.  
         *      
         *  **Note:** This function returns an enum, not the exact number of weights.  
         */
        get_skin_weight_count(): SurfaceTool.SkinWeightCount
        
        /** Sets the color format for this custom [param channel_index]. Use [constant CUSTOM_MAX] to disable.  
         *  Must be invoked after [method begin] and should be set before [method commit] or [method commit_to_arrays].  
         */
        set_custom_format(channel_index: int64, format: SurfaceTool.CustomFormat): void
        
        /** Returns the format for custom [param channel_index] (currently up to 4). Returns [constant CUSTOM_MAX] if this custom channel is unused. */
        get_custom_format(channel_index: int64): SurfaceTool.CustomFormat
        
        /** Called before adding any vertices. Takes the primitive type as an argument (e.g. [constant Mesh.PRIMITIVE_TRIANGLES]). */
        begin(primitive: Mesh.PrimitiveType): void
        
        /** Specifies the position of current vertex. Should be called after specifying other vertex properties (e.g. Color, UV). */
        add_vertex(vertex: Vector3): void
        
        /** Specifies a [Color] to use for the  *next*  vertex. If every vertex needs to have this information set and you fail to submit it for the first vertex, this information may not be used at all.  
         *      
         *  **Note:** The material must have [member BaseMaterial3D.vertex_color_use_as_albedo] enabled for the vertex color to be visible.  
         */
        set_color(color: Color): void
        
        /** Specifies a normal to use for the  *next*  vertex. If every vertex needs to have this information set and you fail to submit it for the first vertex, this information may not be used at all. */
        set_normal(normal: Vector3): void
        
        /** Specifies a tangent to use for the  *next*  vertex. If every vertex needs to have this information set and you fail to submit it for the first vertex, this information may not be used at all.  
         *      
         *  **Note:** Even though [param tangent] is a [Plane], it does not directly represent the tangent plane. Its [member Plane.x], [member Plane.y], and [member Plane.z] represent the tangent vector and [member Plane.d] should be either `-1` or `1`. See also [constant Mesh.ARRAY_TANGENT].  
         */
        set_tangent(tangent: Plane): void
        
        /** Specifies a set of UV coordinates to use for the  *next*  vertex. If every vertex needs to have this information set and you fail to submit it for the first vertex, this information may not be used at all. */
        set_uv(uv: Vector2): void
        
        /** Specifies an optional second set of UV coordinates to use for the  *next*  vertex. If every vertex needs to have this information set and you fail to submit it for the first vertex, this information may not be used at all. */
        set_uv2(uv2: Vector2): void
        
        /** Specifies an array of bones to use for the  *next*  vertex. [param bones] must contain 4 integers. */
        set_bones(bones: PackedInt32Array | int32[]): void
        
        /** Specifies weight values to use for the  *next*  vertex. [param weights] must contain 4 values. If every vertex needs to have this information set and you fail to submit it for the first vertex, this information may not be used at all. */
        set_weights(weights: PackedFloat32Array | float32[]): void
        
        /** Sets the custom value on this vertex for [param channel_index].  
         *  [method set_custom_format] must be called first for this [param channel_index]. Formats which are not RGBA will ignore other color channels.  
         */
        set_custom(channel_index: int64, custom_color: Color): void
        
        /** Specifies the smooth group to use for the  *next*  vertex. If this is never called, all vertices will have the default smooth group of `0` and will be smoothed with adjacent vertices of the same group. To produce a mesh with flat normals, set the smooth group to `-1`.  
         *      
         *  **Note:** This function actually takes a `uint32_t`, so C# users should use `uint32.MaxValue` instead of `-1` to produce a mesh with flat normals.  
         */
        set_smooth_group(index: int64): void
        
        /** Inserts a triangle fan made of array data into [Mesh] being constructed.  
         *  Requires the primitive type be set to [constant Mesh.PRIMITIVE_TRIANGLES].  
         */
        add_triangle_fan(vertices: PackedVector3Array | Vector3[], uvs?: PackedVector2Array | Vector2[] /* = [] */, colors?: PackedColorArray | Color[] /* = [] */, uv2s?: PackedVector2Array | Vector2[] /* = [] */, normals?: PackedVector3Array | Vector3[] /* = [] */, tangents?: GArray<Plane>): void
        
        /** Adds a vertex to index array if you are using indexed vertices. Does not need to be called before adding vertices. */
        add_index(index: int64): void
        
        /** Shrinks the vertex array by creating an index array. This can improve performance by avoiding vertex reuse. */
        index(): void
        
        /** Removes the index array by expanding the vertex array. */
        deindex(): void
        
        /** Generates normals from vertices so you do not have to do it manually. If [param flip] is `true`, the resulting normals will be inverted. [method generate_normals] should be called  *after*  generating geometry and  *before*  committing the mesh using [method commit] or [method commit_to_arrays]. For correct display of normal-mapped surfaces, you will also have to generate tangents using [method generate_tangents].  
         *      
         *  **Note:** [method generate_normals] only works if the primitive type is set to [constant Mesh.PRIMITIVE_TRIANGLES].  
         *      
         *  **Note:** [method generate_normals] takes smooth groups into account. To generate smooth normals, set the smooth group to a value greater than or equal to `0` using [method set_smooth_group] or leave the smooth group at the default of `0`. To generate flat normals, set the smooth group to `-1` using [method set_smooth_group] prior to adding vertices.  
         */
        generate_normals(flip?: boolean /* = false */): void
        
        /** Generates a tangent vector for each vertex. Requires that each vertex already has UVs and normals set (see [method generate_normals]). */
        generate_tangents(): void
        
        /** Optimizes triangle sorting for performance. Requires that [method get_primitive_type] is [constant Mesh.PRIMITIVE_TRIANGLES]. */
        optimize_indices_for_cache(): void
        
        /** Returns the axis-aligned bounding box of the vertex positions. */
        get_aabb(): AABB
        
        /** Generates an LOD for a given [param nd_threshold] in linear units (square root of quadric error metric), using at most [param target_index_count] indices. */
        generate_lod(nd_threshold: float64, target_index_count?: int64 /* = 3 */): PackedInt32Array
        
        /** Sets [Material] to be used by the [Mesh] you are constructing. */
        set_material(material: Material): void
        
        /** Returns the type of mesh geometry, such as [constant Mesh.PRIMITIVE_TRIANGLES]. */
        get_primitive_type(): Mesh.PrimitiveType
        
        /** Clear all information passed into the surface tool so far. */
        clear(): void
        
        /** Creates a vertex array from an existing [Mesh]. */
        create_from(existing: Mesh, surface: int64): void
        
        /** Creates this SurfaceTool from existing vertex arrays such as returned by [method commit_to_arrays], [method Mesh.surface_get_arrays], [method Mesh.surface_get_blend_shape_arrays], [method ImporterMesh.get_surface_arrays], and [method ImporterMesh.get_surface_blend_shape_arrays]. [param primitive_type] controls the type of mesh data, defaulting to [constant Mesh.PRIMITIVE_TRIANGLES]. */
        create_from_arrays(arrays: GArray, primitive_type?: Mesh.PrimitiveType /* = 3 */): void
        
        /** Creates a vertex array from the specified blend shape of an existing [Mesh]. This can be used to extract a specific pose from a blend shape. */
        create_from_blend_shape(existing: Mesh, surface: int64, blend_shape: string): void
        
        /** Append vertices from a given [Mesh] surface onto the current vertex array with specified [Transform3D]. */
        append_from(existing: Mesh, surface: int64, transform: Transform3D): void
        
        /** Returns a constructed [ArrayMesh] from current information passed in. If an existing [ArrayMesh] is passed in as an argument, will add an extra surface to the existing [ArrayMesh].  
         *  The [param flags] argument can be the bitwise OR of [constant Mesh.ARRAY_FLAG_USE_DYNAMIC_UPDATE], [constant Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS], or [constant Mesh.ARRAY_FLAG_USES_EMPTY_VERTEX_ARRAY].  
         */
        commit(existing?: ArrayMesh, flags?: int64 /* = 0 */): null | ArrayMesh
        
        /** Commits the data to the same format used by [method ArrayMesh.add_surface_from_arrays], [method ImporterMesh.add_surface], and [method create_from_arrays]. This way you can further process the mesh data using the [ArrayMesh] or [ImporterMesh] APIs. */
        commit_to_arrays(): GArray
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSurfaceTool;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSyntaxHighlighter extends __NameMapResource {
    }
    /** Base class for syntax highlighters. Provides syntax highlighting data to a [TextEdit].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_syntaxhighlighter.html  
     */
    class SyntaxHighlighter extends Resource {
        constructor(identifier?: any)
        /** Virtual method which can be overridden to return syntax highlighting data.  
         *  See [method get_line_syntax_highlighting] for more details.  
         */
        /* gdvirtual */ _get_line_syntax_highlighting(line: int64): GDictionary
        
        /** Virtual method which can be overridden to clear any local caches. */
        /* gdvirtual */ _clear_highlighting_cache(): void
        
        /** Virtual method which can be overridden to update any local caches. */
        /* gdvirtual */ _update_cache(): void
        
        /** Returns the syntax highlighting data for the line at index [param line]. If the line is not cached, calls [method _get_line_syntax_highlighting] first to calculate the data.  
         *  Each entry is a column number containing a nested [Dictionary]. The column number denotes the start of a region, the region will end if another region is found, or at the end of the line. The nested [Dictionary] contains the data for that region. Currently only the key `"color"` is supported.  
         *  **Example:** Possible return value. This means columns `0` to `4` should be red, and columns `5` to the end of the line should be green:  
         *    
         */
        get_line_syntax_highlighting(line: int64): GDictionary
        
        /** Clears then updates the [SyntaxHighlighter] caches. Override [method _update_cache] for a callback.  
         *      
         *  **Note:** This is called automatically when the associated [TextEdit] node, updates its own cache.  
         */
        update_cache(): void
        
        /** Clears all cached syntax highlighting data.  
         *  Then calls overridable method [method _clear_highlighting_cache].  
         */
        clear_highlighting_cache(): void
        
        /** Returns the associated [TextEdit] node. */
        get_text_edit(): null | TextEdit
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSyntaxHighlighter;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapSystemFont extends __NameMapFont {
    }
    /** A font loaded from a system font. Falls back to a default theme font if not implemented on the host OS.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_systemfont.html  
     */
    class SystemFont extends Font {
        constructor(identifier?: any)
        /** Array of font family names to search, first matching font found is used. */
        get font_names(): PackedStringArray
        set font_names(value: PackedStringArray | string[])
        
        /** If set to `true`, italic or oblique font is preferred. */
        get font_italic(): boolean
        set font_italic(value: boolean)
        
        /** Preferred weight (boldness) of the font. A value in the `100...999` range, normal font weight is `400`, bold font weight is `700`. */
        get font_weight(): int64
        set font_weight(value: int64)
        
        /** Preferred font stretch amount, compared to a normal width. A percentage value between `50%` and `200%`. */
        get font_stretch(): int64
        set font_stretch(value: int64)
        
        /** Font anti-aliasing mode. */
        get antialiasing(): int64
        set antialiasing(value: int64)
        
        /** If set to `true`, generate mipmaps for the font textures. */
        get generate_mipmaps(): boolean
        set generate_mipmaps(value: boolean)
        
        /** If set to `true`, embedded font bitmap loading is disabled (bitmap-only and color fonts ignore this property). */
        get disable_embedded_bitmaps(): boolean
        set disable_embedded_bitmaps(value: boolean)
        
        /** If set to `true`, system fonts can be automatically used as fallbacks. */
        get allow_system_fallback(): boolean
        set allow_system_fallback(value: boolean)
        
        /** If set to `true`, auto-hinting is supported and preferred over font built-in hinting. */
        get force_autohinter(): boolean
        set force_autohinter(value: boolean)
        
        /** If set to `true`, color modulation is applied when drawing colored glyphs, otherwise it's applied to the monochrome glyphs only. */
        get modulate_color_glyphs(): boolean
        set modulate_color_glyphs(value: boolean)
        
        /** Font hinting mode. */
        get hinting(): int64
        set hinting(value: int64)
        
        /** Font glyph subpixel positioning mode. Subpixel positioning provides shaper text and better kerning for smaller font sizes, at the cost of memory usage and font rasterization speed. Use [constant TextServer.SUBPIXEL_POSITIONING_AUTO] to automatically enable it based on the font size. */
        get subpixel_positioning(): int64
        set subpixel_positioning(value: int64)
        
        /** If set to `true`, when aligning glyphs to the pixel boundaries rounding remainders are accumulated to ensure more uniform glyph distribution. This setting has no effect if subpixel positioning is enabled. */
        get keep_rounding_remainders(): boolean
        set keep_rounding_remainders(value: boolean)
        
        /** If set to `true`, glyphs of all sizes are rendered using single multichannel signed distance field generated from the dynamic font vector data. */
        get multichannel_signed_distance_field(): boolean
        set multichannel_signed_distance_field(value: boolean)
        
        /** The width of the range around the shape between the minimum and maximum representable signed distance. If using font outlines, [member msdf_pixel_range] must be set to at least  *twice*  the size of the largest font outline. The default [member msdf_pixel_range] value of `16` allows outline sizes up to `8` to look correct. */
        get msdf_pixel_range(): int64
        set msdf_pixel_range(value: int64)
        
        /** Source font size used to generate MSDF textures. Higher values allow for more precision, but are slower to render and require more memory. Only increase this value if you notice a visible lack of precision in glyph rendering. */
        get msdf_size(): int64
        set msdf_size(value: int64)
        
        /** If set to a positive value, overrides the oversampling factor of the viewport this font is used in. See [member Viewport.oversampling]. This value doesn't override the [code skip-lint]oversampling` parameter of [code skip-lint]draw_*` methods. */
        get oversampling(): float64
        set oversampling(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapSystemFont;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTCPServer extends __NameMapSocketServer {
    }
    /** A TCP server.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tcpserver.html  
     */
    class TCPServer extends SocketServer {
        constructor(identifier?: any)
        /** Listen on the [param port] binding to [param bind_address].  
         *  If [param bind_address] is set as `"*"` (default), the server will listen on all available addresses (both IPv4 and IPv6).  
         *  If [param bind_address] is set as `"0.0.0.0"` (for IPv4) or `"::"` (for IPv6), the server will listen on all available addresses matching that IP type.  
         *  If [param bind_address] is set to any valid address (e.g. `"192.168.1.101"`, `"::1"`, etc.), the server will only listen on the interface with that address (or fail if no interface with the given address exists).  
         */
        listen(port: int64, bind_address?: string /* = '*' */): Error
        
        /** Returns the local port this server is listening to. */
        get_local_port(): int64
        
        /** If a connection is available, returns a StreamPeerTCP with the connection. */
        take_connection(): null | StreamPeerTCP
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTCPServer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTLSOptions extends __NameMapRefCounted {
    }
    /** TLS configuration for clients and servers.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tlsoptions.html  
     */
    class TLSOptions extends RefCounted {
        constructor(identifier?: any)
        /** Creates a TLS client configuration which validates certificates and their common names (fully qualified domain names).  
         *  You can specify a custom [param trusted_chain] of certification authorities (the default CA list will be used if `null`), and optionally provide a [param common_name_override] if you expect the certificate to have a common name other than the server FQDN.  
         *      
         *  **Note:** On the Web platform, TLS verification is always enforced against the CA list of the web browser. This is considered a security feature.  
         */
        static client(trusted_chain?: X509Certificate, common_name_override?: string /* = '' */): null | TLSOptions
        
        /** Creates an **unsafe** TLS client configuration where certificate validation is optional. You can optionally provide a valid [param trusted_chain], but the common name of the certificates will never be checked. Using this configuration for purposes other than testing **is not recommended**.  
         *      
         *  **Note:** On the Web platform, TLS verification is always enforced against the CA list of the web browser. This is considered a security feature.  
         */
        static client_unsafe(trusted_chain?: X509Certificate): null | TLSOptions
        
        /** Creates a TLS server configuration using the provided [param key] and [param certificate].  
         *      
         *  **Note:** The [param certificate] should include the full certificate chain up to the signing CA (certificates file can be concatenated using a general purpose text editor).  
         */
        static server(key: CryptoKey, certificate: X509Certificate): null | TLSOptions
        
        /** Returns `true` if created with [method TLSOptions.server], `false` otherwise. */
        is_server(): boolean
        
        /** Returns `true` if created with [method TLSOptions.client_unsafe], `false` otherwise. */
        is_unsafe_client(): boolean
        
        /** Returns the common name (domain name) override specified when creating with [method TLSOptions.client]. */
        get_common_name_override(): string
        
        /** Returns the CA [X509Certificate] chain specified when creating with [method TLSOptions.client] or [method TLSOptions.client_unsafe]. */
        get_trusted_ca_chain(): null | X509Certificate
        
        /** Returns the [CryptoKey] specified when creating with [method TLSOptions.server]. */
        get_private_key(): null | CryptoKey
        
        /** Returns the [X509Certificate] specified when creating with [method TLSOptions.server]. */
        get_own_certificate(): null | X509Certificate
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTLSOptions;
    }
    namespace TabBar {
        enum AlignmentMode {
            /** Aligns tabs to the left. */
            ALIGNMENT_LEFT = 0,
            
            /** Aligns tabs in the middle. */
            ALIGNMENT_CENTER = 1,
            
            /** Aligns tabs to the right. */
            ALIGNMENT_RIGHT = 2,
            
            /** Represents the size of the [enum AlignmentMode] enum. */
            ALIGNMENT_MAX = 3,
        }
        enum CloseButtonDisplayPolicy {
            /** Never show the close buttons. */
            CLOSE_BUTTON_SHOW_NEVER = 0,
            
            /** Only show the close button on the currently active tab. */
            CLOSE_BUTTON_SHOW_ACTIVE_ONLY = 1,
            
            /** Show the close button on all tabs. */
            CLOSE_BUTTON_SHOW_ALWAYS = 2,
            
            /** Represents the size of the [enum CloseButtonDisplayPolicy] enum. */
            CLOSE_BUTTON_MAX = 3,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTabBar extends __NameMapControl {
    }
    /** A control that provides a horizontal bar with tabs.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tabbar.html  
     */
    class TabBar<Map extends NodePathMap = any> extends Control<Map> {
        constructor(identifier?: any)
        /** Returns the previously active tab index. */
        get_previous_tab(): int64
        
        /** Selects the first available tab with lower index than the currently selected. Returns `true` if tab selection changed. */
        select_previous_available(): boolean
        
        /** Selects the first available tab with greater index than the currently selected. Returns `true` if tab selection changed. */
        select_next_available(): boolean
        
        /** Sets a [param title] for the tab at index [param tab_idx]. */
        set_tab_title(tab_idx: int64, title: string): void
        
        /** Returns the title of the tab at index [param tab_idx]. */
        get_tab_title(tab_idx: int64): string
        
        /** Sets a [param tooltip] for tab at index [param tab_idx].  
         *      
         *  **Note:** By default, if the [param tooltip] is empty and the tab text is truncated (not all characters fit into the tab), the title will be displayed as a tooltip. To hide the tooltip, assign `" "` as the [param tooltip] text.  
         */
        set_tab_tooltip(tab_idx: int64, tooltip: string): void
        
        /** Returns the tooltip text of the tab at index [param tab_idx]. */
        get_tab_tooltip(tab_idx: int64): string
        
        /** Sets tab title base writing direction. */
        set_tab_text_direction(tab_idx: int64, direction: Control.TextDirection): void
        
        /** Returns tab title text base writing direction. */
        get_tab_text_direction(tab_idx: int64): Control.TextDirection
        
        /** Sets the language code of the title for the tab at index [param tab_idx] to [param language]. This is used for line-breaking and text shaping algorithms. If [param language] is empty, the current locale is used. */
        set_tab_language(tab_idx: int64, language: string): void
        
        /** Returns tab title language code. */
        get_tab_language(tab_idx: int64): string
        
        /** Sets an [param icon] for the tab at index [param tab_idx]. */
        set_tab_icon(tab_idx: int64, icon: Texture2D): void
        
        /** Returns the icon for the tab at index [param tab_idx] or `null` if the tab has no icon. */
        get_tab_icon(tab_idx: int64): null | Texture2D
        
        /** Sets the maximum allowed width of the icon for the tab at index [param tab_idx]. This limit is applied on top of the default size of the icon and on top of [theme_item icon_max_width]. The height is adjusted according to the icon's ratio. */
        set_tab_icon_max_width(tab_idx: int64, width: int64): void
        
        /** Returns the maximum allowed width of the icon for the tab at index [param tab_idx]. */
        get_tab_icon_max_width(tab_idx: int64): int64
        
        /** Sets an [param icon] for the button of the tab at index [param tab_idx] (located to the right, before the close button), making it visible and clickable (See [signal tab_button_pressed]). Giving it a `null` value will hide the button. */
        set_tab_button_icon(tab_idx: int64, icon: Texture2D): void
        
        /** Returns the icon for the right button of the tab at index [param tab_idx] or `null` if the right button has no icon. */
        get_tab_button_icon(tab_idx: int64): null | Texture2D
        
        /** If [param disabled] is `true`, disables the tab at index [param tab_idx], making it non-interactable. */
        set_tab_disabled(tab_idx: int64, disabled: boolean): void
        
        /** Returns `true` if the tab at index [param tab_idx] is disabled. */
        is_tab_disabled(tab_idx: int64): boolean
        
        /** If [param hidden] is `true`, hides the tab at index [param tab_idx], making it disappear from the tab area. */
        set_tab_hidden(tab_idx: int64, hidden: boolean): void
        
        /** Returns `true` if the tab at index [param tab_idx] is hidden. */
        is_tab_hidden(tab_idx: int64): boolean
        
        /** Sets the metadata value for the tab at index [param tab_idx], which can be retrieved later using [method get_tab_metadata]. */
        set_tab_metadata(tab_idx: int64, metadata: any): void
        
        /** Returns the metadata value set to the tab at index [param tab_idx] using [method set_tab_metadata]. If no metadata was previously set, returns `null` by default. */
        get_tab_metadata(tab_idx: int64): any
        
        /** Removes the tab at index [param tab_idx]. */
        remove_tab(tab_idx: int64): void
        
        /** Adds a new tab. */
        add_tab(title?: string /* = '' */, icon?: Texture2D): void
        
        /** Returns the index of the tab at local coordinates [param point]. Returns `-1` if the point is outside the control boundaries or if there's no tab at the queried position. */
        get_tab_idx_at_point(point: Vector2): int64
        
        /** Returns the number of hidden tabs offsetted to the left. */
        get_tab_offset(): int64
        
        /** Returns `true` if the offset buttons (the ones that appear when there's not enough space for all tabs) are visible. */
        get_offset_buttons_visible(): boolean
        
        /** Moves the scroll view to make the tab visible. */
        ensure_tab_visible(idx: int64): void
        
        /** Returns tab [Rect2] with local position and size. */
        get_tab_rect(tab_idx: int64): Rect2
        
        /** Moves a tab from [param from] to [param to]. */
        move_tab(from: int64, to: int64): void
        
        /** Clears all tabs. */
        clear_tabs(): void
        
        /** The index of the current selected tab. A value of `-1` means that no tab is selected and can only be set when [member deselect_enabled] is `true` or if all tabs are hidden or disabled. */
        get current_tab(): int64
        set current_tab(value: int64)
        
        /** The horizontal alignment of the tabs. */
        get tab_alignment(): int64
        set tab_alignment(value: int64)
        
        /** If `true`, tabs overflowing this node's width will be hidden, displaying two navigation buttons instead. Otherwise, this node's minimum size is updated so that all tabs are visible. */
        get clip_tabs(): boolean
        set clip_tabs(value: boolean)
        
        /** If `true`, middle-clicking on a tab will emit the [signal tab_close_pressed] signal. */
        get close_with_middle_mouse(): boolean
        set close_with_middle_mouse(value: boolean)
        
        /** When the close button will appear on the tabs. */
        get tab_close_display_policy(): int64
        set tab_close_display_policy(value: int64)
        
        /** Sets the maximum width which all tabs should be limited to. Unlimited if set to `0`. */
        get max_tab_width(): int64
        set max_tab_width(value: int64)
        
        /** if `true`, the mouse's scroll wheel can be used to navigate the scroll view. */
        get scrolling_enabled(): boolean
        set scrolling_enabled(value: boolean)
        
        /** If `true`, tabs can be rearranged with mouse drag. */
        get drag_to_rearrange_enabled(): boolean
        set drag_to_rearrange_enabled(value: boolean)
        
        /** If `true`, hovering over a tab while dragging something will switch to that tab. Does not have effect when hovering another tab to rearrange. The delay for when this happens is dictated by [theme_item hover_switch_wait_msec]. */
        get switch_on_drag_hover(): boolean
        set switch_on_drag_hover(value: boolean)
        
        /** [TabBar]s with the same rearrange group ID will allow dragging the tabs between them. Enable drag with [member drag_to_rearrange_enabled].  
         *  Setting this to `-1` will disable rearranging between [TabBar]s.  
         */
        get tabs_rearrange_group(): int64
        set tabs_rearrange_group(value: int64)
        
        /** If `true`, the tab offset will be changed to keep the currently selected tab visible. */
        get scroll_to_selected(): boolean
        set scroll_to_selected(value: boolean)
        
        /** If `true`, enables selecting a tab with the right mouse button. */
        get select_with_rmb(): boolean
        set select_with_rmb(value: boolean)
        
        /** If `true`, all tabs can be deselected so that no tab is selected. Click on the current tab to deselect it. */
        get deselect_enabled(): boolean
        set deselect_enabled(value: boolean)
        
        /** The number of tabs currently in the bar. */
        get tab_count(): int64
        set tab_count(value: int64)
        
        /** Emitted when a tab is selected via click, directional input, or script, even if it is the current tab. */
        readonly tab_selected: Signal<(tab: int64) => void>
        
        /** Emitted when switching to another tab. */
        readonly tab_changed: Signal<(tab: int64) => void>
        
        /** Emitted when a tab is clicked, even if it is the current tab. */
        readonly tab_clicked: Signal<(tab: int64) => void>
        
        /** Emitted when a tab is right-clicked. */
        readonly tab_rmb_clicked: Signal<(tab: int64) => void>
        
        /** Emitted when a tab's close button is pressed or, if [member close_with_middle_mouse] is `true`, when middle-clicking on a tab.  
         *      
         *  **Note:** Tabs are not removed automatically; this behavior needs to be coded manually. For example:  
         *    
         */
        readonly tab_close_pressed: Signal<(tab: int64) => void>
        
        /** Emitted when a tab's right button is pressed. See [method set_tab_button_icon]. */
        readonly tab_button_pressed: Signal<(tab: int64) => void>
        
        /** Emitted when a tab is hovered by the mouse. */
        readonly tab_hovered: Signal<(tab: int64) => void>
        
        /** Emitted when the active tab is rearranged via mouse drag. See [member drag_to_rearrange_enabled]. */
        readonly active_tab_rearranged: Signal<(idx_to: int64) => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTabBar;
    }
    namespace TabContainer {
        enum TabPosition {
            /** Places the tab bar at the top. */
            POSITION_TOP = 0,
            
            /** Places the tab bar at the bottom. The tab bar's [StyleBox] will be flipped vertically. */
            POSITION_BOTTOM = 1,
            
            /** Represents the size of the [enum TabPosition] enum. */
            POSITION_MAX = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTabContainer extends __NameMapContainer {
    }
    /** A container that creates a tab for each child control, displaying only the active tab's control.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tabcontainer.html  
     */
    class TabContainer<Map extends NodePathMap = any> extends Container<Map> {
        constructor(identifier?: any)
        /** Returns the number of tabs. */
        get_tab_count(): int64
        
        /** Returns the previously active tab index. */
        get_previous_tab(): int64
        
        /** Selects the first available tab with lower index than the currently selected. Returns `true` if tab selection changed. */
        select_previous_available(): boolean
        
        /** Selects the first available tab with greater index than the currently selected. Returns `true` if tab selection changed. */
        select_next_available(): boolean
        
        /** Returns the child [Control] node located at the active tab index. */
        get_current_tab_control(): null | Control
        
        /** Returns the [TabBar] contained in this container.  
         *  **Warning:** This is a required internal node, removing and freeing it or editing its tabs may cause a crash. If you wish to edit the tabs, use the methods provided in [TabContainer].  
         */
        get_tab_bar(): null | TabBar
        
        /** Returns the [Control] node from the tab at index [param tab_idx]. */
        get_tab_control(tab_idx: int64): null | Control
        
        /** Sets a custom title for the tab at index [param tab_idx] (tab titles default to the name of the indexed child node). Set it back to the child's name to make the tab default to it again. */
        set_tab_title(tab_idx: int64, title: string): void
        
        /** Returns the title of the tab at index [param tab_idx]. Tab titles default to the name of the indexed child node, but this can be overridden with [method set_tab_title]. */
        get_tab_title(tab_idx: int64): string
        
        /** Sets a custom tooltip text for tab at index [param tab_idx].  
         *      
         *  **Note:** By default, if the [param tooltip] is empty and the tab text is truncated (not all characters fit into the tab), the title will be displayed as a tooltip. To hide the tooltip, assign `" "` as the [param tooltip] text.  
         */
        set_tab_tooltip(tab_idx: int64, tooltip: string): void
        
        /** Returns the tooltip text of the tab at index [param tab_idx]. */
        get_tab_tooltip(tab_idx: int64): string
        
        /** Sets an icon for the tab at index [param tab_idx]. */
        set_tab_icon(tab_idx: int64, icon: Texture2D): void
        
        /** Returns the [Texture2D] for the tab at index [param tab_idx] or `null` if the tab has no [Texture2D]. */
        get_tab_icon(tab_idx: int64): null | Texture2D
        
        /** Sets the maximum allowed width of the icon for the tab at index [param tab_idx]. This limit is applied on top of the default size of the icon and on top of [theme_item icon_max_width]. The height is adjusted according to the icon's ratio. */
        set_tab_icon_max_width(tab_idx: int64, width: int64): void
        
        /** Returns the maximum allowed width of the icon for the tab at index [param tab_idx]. */
        get_tab_icon_max_width(tab_idx: int64): int64
        
        /** If [param disabled] is `true`, disables the tab at index [param tab_idx], making it non-interactable. */
        set_tab_disabled(tab_idx: int64, disabled: boolean): void
        
        /** Returns `true` if the tab at index [param tab_idx] is disabled. */
        is_tab_disabled(tab_idx: int64): boolean
        
        /** If [param hidden] is `true`, hides the tab at index [param tab_idx], making it disappear from the tab area. */
        set_tab_hidden(tab_idx: int64, hidden: boolean): void
        
        /** Returns `true` if the tab at index [param tab_idx] is hidden. */
        is_tab_hidden(tab_idx: int64): boolean
        
        /** Sets the metadata value for the tab at index [param tab_idx], which can be retrieved later using [method get_tab_metadata]. */
        set_tab_metadata(tab_idx: int64, metadata: any): void
        
        /** Returns the metadata value set to the tab at index [param tab_idx] using [method set_tab_metadata]. If no metadata was previously set, returns `null` by default. */
        get_tab_metadata(tab_idx: int64): any
        
        /** Sets the button icon from the tab at index [param tab_idx]. */
        set_tab_button_icon(tab_idx: int64, icon: Texture2D): void
        
        /** Returns the button icon from the tab at index [param tab_idx]. */
        get_tab_button_icon(tab_idx: int64): null | Texture2D
        
        /** Returns the index of the tab at local coordinates [param point]. Returns `-1` if the point is outside the control boundaries or if there's no tab at the queried position. */
        get_tab_idx_at_point(point: Vector2): int64
        
        /** Returns the index of the tab tied to the given [param control]. The control must be a child of the [TabContainer]. */
        get_tab_idx_from_control(control: Control): int64
        
        /** If set on a [Popup] node instance, a popup menu icon appears in the top-right corner of the [TabContainer] (setting it to `null` will make it go away). Clicking it will expand the [Popup] node. */
        set_popup(popup: Node): void
        
        /** Returns the [Popup] node instance if one has been set already with [method set_popup].  
         *  **Warning:** This is a required internal node, removing and freeing it may cause a crash. If you wish to hide it or any of its children, use their [member Window.visible] property.  
         */
        get_popup(): null | Popup
        
        /** The position at which tabs will be placed. */
        get tab_alignment(): int64
        set tab_alignment(value: int64)
        
        /** The current tab index. When set, this index's [Control] node's `visible` property is set to `true` and all others are set to `false`.  
         *  A value of `-1` means that no tab is selected.  
         */
        get current_tab(): int64
        set current_tab(value: int64)
        
        /** The horizontal alignment of the tabs. */
        get tabs_position(): int64
        set tabs_position(value: int64)
        
        /** If `true`, tabs overflowing this node's width will be hidden, displaying two navigation buttons instead. Otherwise, this node's minimum size is updated so that all tabs are visible. */
        get clip_tabs(): boolean
        set clip_tabs(value: boolean)
        
        /** If `true`, tabs are visible. If `false`, tabs' content and titles are hidden. */
        get tabs_visible(): boolean
        set tabs_visible(value: boolean)
        
        /** If `true`, all tabs are drawn in front of the panel. If `false`, inactive tabs are drawn behind the panel. */
        get all_tabs_in_front(): boolean
        set all_tabs_in_front(value: boolean)
        
        /** If `true`, hovering over a tab while dragging something will switch to that tab. Does not have effect when hovering another tab to rearrange. */
        get switch_on_drag_hover(): boolean
        set switch_on_drag_hover(value: boolean)
        
        /** If `true`, tabs can be rearranged with mouse drag. */
        get drag_to_rearrange_enabled(): boolean
        set drag_to_rearrange_enabled(value: boolean)
        
        /** [TabContainer]s with the same rearrange group ID will allow dragging the tabs between them. Enable drag with [member drag_to_rearrange_enabled].  
         *  Setting this to `-1` will disable rearranging between [TabContainer]s.  
         */
        get tabs_rearrange_group(): int64
        set tabs_rearrange_group(value: int64)
        
        /** If `true`, child [Control] nodes that are hidden have their minimum size take into account in the total, instead of only the currently visible one. */
        get use_hidden_tabs_for_min_size(): boolean
        set use_hidden_tabs_for_min_size(value: boolean)
        
        /** The focus access mode for the internal [TabBar] node. */
        get tab_focus_mode(): int64
        set tab_focus_mode(value: int64)
        
        /** If `true`, all tabs can be deselected so that no tab is selected. Click on the [member current_tab] to deselect it.  
         *  Only the tab header will be shown if no tabs are selected.  
         */
        get deselect_enabled(): boolean
        set deselect_enabled(value: boolean)
        
        /** Emitted when the active tab is rearranged via mouse drag. See [member drag_to_rearrange_enabled]. */
        readonly active_tab_rearranged: Signal<(idx_to: int64) => void>
        
        /** Emitted when switching to another tab. */
        readonly tab_changed: Signal<(tab: int64) => void>
        
        /** Emitted when a tab is clicked, even if it is the current tab. */
        readonly tab_clicked: Signal<(tab: int64) => void>
        
        /** Emitted when a tab is hovered by the mouse. */
        readonly tab_hovered: Signal<(tab: int64) => void>
        
        /** Emitted when a tab is selected via click, directional input, or script, even if it is the current tab. */
        readonly tab_selected: Signal<(tab: int64) => void>
        
        /** Emitted when the user clicks on the button icon on this tab. */
        readonly tab_button_pressed: Signal<(tab: int64) => void>
        
        /** Emitted when the [TabContainer]'s [Popup] button is clicked. See [method set_popup] for details. */
        readonly pre_popup_pressed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTabContainer;
    }
    namespace TextEdit {
        enum MenuItems {
            /** Cuts (copies and clears) the selected text. */
            MENU_CUT = 0,
            
            /** Copies the selected text. */
            MENU_COPY = 1,
            
            /** Pastes the clipboard text over the selected text (or at the cursor's position). */
            MENU_PASTE = 2,
            
            /** Erases the whole [TextEdit] text. */
            MENU_CLEAR = 3,
            
            /** Selects the whole [TextEdit] text. */
            MENU_SELECT_ALL = 4,
            
            /** Undoes the previous action. */
            MENU_UNDO = 5,
            
            /** Redoes the previous action. */
            MENU_REDO = 6,
            
            /** ID of "Text Writing Direction" submenu. */
            MENU_SUBMENU_TEXT_DIR = 7,
            
            /** Sets text direction to inherited. */
            MENU_DIR_INHERITED = 8,
            
            /** Sets text direction to automatic. */
            MENU_DIR_AUTO = 9,
            
            /** Sets text direction to left-to-right. */
            MENU_DIR_LTR = 10,
            
            /** Sets text direction to right-to-left. */
            MENU_DIR_RTL = 11,
            
            /** Toggles control character display. */
            MENU_DISPLAY_UCC = 12,
            
            /** ID of "Insert Control Character" submenu. */
            MENU_SUBMENU_INSERT_UCC = 13,
            
            /** Inserts left-to-right mark (LRM) character. */
            MENU_INSERT_LRM = 14,
            
            /** Inserts right-to-left mark (RLM) character. */
            MENU_INSERT_RLM = 15,
            
            /** Inserts start of left-to-right embedding (LRE) character. */
            MENU_INSERT_LRE = 16,
            
            /** Inserts start of right-to-left embedding (RLE) character. */
            MENU_INSERT_RLE = 17,
            
            /** Inserts start of left-to-right override (LRO) character. */
            MENU_INSERT_LRO = 18,
            
            /** Inserts start of right-to-left override (RLO) character. */
            MENU_INSERT_RLO = 19,
            
            /** Inserts pop direction formatting (PDF) character. */
            MENU_INSERT_PDF = 20,
            
            /** Inserts Arabic letter mark (ALM) character. */
            MENU_INSERT_ALM = 21,
            
            /** Inserts left-to-right isolate (LRI) character. */
            MENU_INSERT_LRI = 22,
            
            /** Inserts right-to-left isolate (RLI) character. */
            MENU_INSERT_RLI = 23,
            
            /** Inserts first strong isolate (FSI) character. */
            MENU_INSERT_FSI = 24,
            
            /** Inserts pop direction isolate (PDI) character. */
            MENU_INSERT_PDI = 25,
            
            /** Inserts zero width joiner (ZWJ) character. */
            MENU_INSERT_ZWJ = 26,
            
            /** Inserts zero width non-joiner (ZWNJ) character. */
            MENU_INSERT_ZWNJ = 27,
            
            /** Inserts word joiner (WJ) character. */
            MENU_INSERT_WJ = 28,
            
            /** Inserts soft hyphen (SHY) character. */
            MENU_INSERT_SHY = 29,
            
            /** Opens system emoji and symbol picker. */
            MENU_EMOJI_AND_SYMBOL = 30,
            
            /** Represents the size of the [enum MenuItems] enum. */
            MENU_MAX = 31,
        }
        enum EditAction {
            /** No current action. */
            ACTION_NONE = 0,
            
            /** A typing action. */
            ACTION_TYPING = 1,
            
            /** A backwards delete action. */
            ACTION_BACKSPACE = 2,
            
            /** A forward delete action. */
            ACTION_DELETE = 3,
        }
        enum SearchFlags {
            /** Match case when searching. */
            SEARCH_MATCH_CASE = 1,
            
            /** Match whole words when searching. */
            SEARCH_WHOLE_WORDS = 2,
            
            /** Search from end to beginning. */
            SEARCH_BACKWARDS = 4,
        }
        enum CaretType {
            /** Vertical line caret. */
            CARET_TYPE_LINE = 0,
            
            /** Block caret. */
            CARET_TYPE_BLOCK = 1,
        }
        enum SelectionMode {
            /** Not selecting. */
            SELECTION_MODE_NONE = 0,
            
            /** Select as if `shift` is pressed. */
            SELECTION_MODE_SHIFT = 1,
            
            /** Select single characters as if the user single clicked. */
            SELECTION_MODE_POINTER = 2,
            
            /** Select whole words as if the user double clicked. */
            SELECTION_MODE_WORD = 3,
            
            /** Select whole lines as if the user triple clicked. */
            SELECTION_MODE_LINE = 4,
        }
        enum LineWrappingMode {
            /** Line wrapping is disabled. */
            LINE_WRAPPING_NONE = 0,
            
            /** Line wrapping occurs at the control boundary, beyond what would normally be visible. */
            LINE_WRAPPING_BOUNDARY = 1,
        }
        enum GutterType {
            /** When a gutter is set to string using [method set_gutter_type], it is used to contain text set via the [method set_line_gutter_text] method. */
            GUTTER_TYPE_STRING = 0,
            
            /** When a gutter is set to icon using [method set_gutter_type], it is used to contain an icon set via the [method set_line_gutter_icon] method. */
            GUTTER_TYPE_ICON = 1,
            
            /** When a gutter is set to custom using [method set_gutter_type], it is used to contain custom visuals controlled by a callback method set via the [method set_gutter_custom_draw] method. */
            GUTTER_TYPE_CUSTOM = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextEdit extends __NameMapControl {
    }
    /** A multiline text editor.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textedit.html  
     */
    class TextEdit<Map extends NodePathMap = any> extends Control<Map> {
        constructor(identifier?: any)
        /** Override this method to define what happens when the user types in the provided key [param unicode_char]. */
        /* gdvirtual */ _handle_unicode_input(unicode_char: int64, caret_index: int64): void
        
        /** Override this method to define what happens when the user presses the backspace key. */
        /* gdvirtual */ _backspace(caret_index: int64): void
        
        /** Override this method to define what happens when the user performs a cut operation. */
        /* gdvirtual */ _cut(caret_index: int64): void
        
        /** Override this method to define what happens when the user performs a copy operation. */
        /* gdvirtual */ _copy(caret_index: int64): void
        
        /** Override this method to define what happens when the user performs a paste operation. */
        /* gdvirtual */ _paste(caret_index: int64): void
        
        /** Override this method to define what happens when the user performs a paste operation with middle mouse button.  
         *      
         *  **Note:** This method is only implemented on Linux.  
         */
        /* gdvirtual */ _paste_primary_clipboard(caret_index: int64): void
        _set_text(text: string, emit_signal?: boolean /* = false */): void
        
        /** Returns `true` if the user has text in the [url=https://en.wikipedia.org/wiki/Input_method]Input Method Editor[/url] (IME). */
        has_ime_text(): boolean
        
        /** Closes the [url=https://en.wikipedia.org/wiki/Input_method]Input Method Editor[/url] (IME) if it is open. Any text in the IME will be lost. */
        cancel_ime(): void
        
        /** Applies text from the [url=https://en.wikipedia.org/wiki/Input_method]Input Method Editor[/url] (IME) to each caret and closes the IME if it is open. */
        apply_ime(): void
        
        /** Sets the tab size for the [TextEdit] to use. */
        set_tab_size(size: int64): void
        
        /** Returns the [TextEdit]'s' tab size. */
        get_tab_size(): int64
        
        /** If `true`, enables overtype mode. In this mode, typing overrides existing text instead of inserting text. The [member ProjectSettings.input/ui_text_toggle_insert_mode] action toggles overtype mode. See [method is_overtype_mode_enabled]. */
        set_overtype_mode_enabled(enabled: boolean): void
        
        /** Returns `true` if overtype mode is enabled. See [method set_overtype_mode_enabled]. */
        is_overtype_mode_enabled(): boolean
        
        /** Performs a full reset of [TextEdit], including undo history. */
        clear(): void
        
        /** Returns the number of lines in the text. */
        get_line_count(): int64
        
        /** Sets the text for a specific [param line].  
         *  Carets on the line will attempt to keep their visual x position.  
         */
        set_line(line: int64, new_text: string): void
        
        /** Returns the text of a specific line. */
        get_line(line: int64): string
        
        /** Returns line text as it is currently displayed, including IME composition string. */
        get_line_with_ime(line: int64): string
        
        /** Returns the width in pixels of the [param wrap_index] on [param line]. */
        get_line_width(line: int64, wrap_index?: int64 /* = -1 */): int64
        
        /** Returns the maximum value of the line height among all lines.  
         *      
         *  **Note:** The return value is influenced by [theme_item line_spacing] and [theme_item font_size]. And it will not be less than `1`.  
         */
        get_line_height(): int64
        
        /** Returns the indent level of the given line. This is the number of spaces and tabs at the beginning of the line, with the tabs taking the tab size into account (see [method get_tab_size]). */
        get_indent_level(line: int64): int64
        
        /** Returns the first column containing a non-whitespace character on the given line. If there is only whitespace, returns the number of characters. */
        get_first_non_whitespace_column(line: int64): int64
        
        /** Swaps the two lines. Carets will be swapped with the lines. */
        swap_lines(from_line: int64, to_line: int64): void
        
        /** Inserts a new line with [param text] at [param line]. */
        insert_line_at(line: int64, text: string): void
        
        /** Removes the line of text at [param line]. Carets on this line will attempt to match their previous visual x position.  
         *  If [param move_carets_down] is `true` carets will move to the next line down, otherwise carets will move up.  
         */
        remove_line_at(line: int64, move_carets_down?: boolean /* = true */): void
        
        /** Insert the specified text at the caret position. */
        insert_text_at_caret(text: string, caret_index?: int64 /* = -1 */): void
        
        /** Inserts the [param text] at [param line] and [param column].  
         *  If [param before_selection_begin] is `true`, carets and selections that begin at [param line] and [param column] will moved to the end of the inserted text, along with all carets after it.  
         *  If [param before_selection_end] is `true`, selections that end at [param line] and [param column] will be extended to the end of the inserted text. These parameters can be used to insert text inside of or outside of selections.  
         */
        insert_text(text: string, line: int64, column: int64, before_selection_begin?: boolean /* = true */, before_selection_end?: boolean /* = false */): void
        
        /** Removes text between the given positions. */
        remove_text(from_line: int64, from_column: int64, to_line: int64, to_column: int64): void
        
        /** Returns the last unhidden line in the entire [TextEdit]. */
        get_last_unhidden_line(): int64
        
        /** Returns the count to the next visible line from [param line] to `line + visible_amount`. Can also count backwards. For example if a [TextEdit] has 5 lines with lines 2 and 3 hidden, calling this with `line = 1, visible_amount = 1` would return 3. */
        get_next_visible_line_offset_from(line: int64, visible_amount: int64): int64
        
        /** Similar to [method get_next_visible_line_offset_from], but takes into account the line wrap indexes. In the returned vector, `x` is the line, `y` is the wrap index. */
        get_next_visible_line_index_offset_from(line: int64, wrap_index: int64, visible_amount: int64): Vector2i
        
        /** Called when the user presses the backspace key. Can be overridden with [method _backspace]. */
        backspace(caret_index?: int64 /* = -1 */): void
        
        /** Cut's the current selection. Can be overridden with [method _cut]. */
        cut(caret_index?: int64 /* = -1 */): void
        
        /** Copies the current text selection. Can be overridden with [method _copy]. */
        copy(caret_index?: int64 /* = -1 */): void
        
        /** Paste at the current location. Can be overridden with [method _paste]. */
        paste(caret_index?: int64 /* = -1 */): void
        
        /** Pastes the primary clipboard. */
        paste_primary_clipboard(caret_index?: int64 /* = -1 */): void
        
        /** Starts an action, will end the current action if [param action] is different.  
         *  An action will also end after a call to [method end_action], after [member ProjectSettings.gui/timers/text_edit_idle_detect_sec] is triggered or a new undoable step outside the [method start_action] and [method end_action] calls.  
         */
        start_action(action: TextEdit.EditAction): void
        
        /** Marks the end of steps in the current action started with [method start_action]. */
        end_action(): void
        
        /** Starts a multipart edit. All edits will be treated as one action until [method end_complex_operation] is called. */
        begin_complex_operation(): void
        
        /** Ends a multipart edit, started with [method begin_complex_operation]. If called outside a complex operation, the current operation is pushed onto the undo/redo stack. */
        end_complex_operation(): void
        
        /** Returns `true` if an "undo" action is available. */
        has_undo(): boolean
        
        /** Returns `true` if a "redo" action is available. */
        has_redo(): boolean
        
        /** Perform undo operation. */
        undo(): void
        
        /** Perform redo operation. */
        redo(): void
        
        /** Clears the undo history. */
        clear_undo_history(): void
        
        /** Tag the current version as saved. */
        tag_saved_version(): void
        
        /** Returns the current version of the [TextEdit]. The version is a count of recorded operations by the undo/redo history. */
        get_version(): int64
        
        /** Returns the last tagged saved version from [method tag_saved_version]. */
        get_saved_version(): int64
        
        /** Sets the search text. See [method set_search_flags]. */
        set_search_text(search_text: string): void
        
        /** Sets the search [param flags]. This is used with [method set_search_text] to highlight occurrences of the searched text. Search flags can be specified from the [enum SearchFlags] enum. */
        set_search_flags(flags: int64): void
        
        /** Perform a search inside the text. Search flags can be specified in the [enum SearchFlags] enum.  
         *  In the returned vector, `x` is the column, `y` is the line. If no results are found, both are equal to `-1`.  
         *    
         */
        search(text: string, flags: int64, from_line: int64, from_column: int64): Vector2i
        
        /** Provide custom tooltip text. The callback method must take the following args: `hovered_word: String`. */
        set_tooltip_request_func(callback: Callable): void
        
        /** Returns the local mouse position adjusted for the text direction. */
        get_local_mouse_pos(): Vector2
        
        /** Returns the word at [param position]. */
        get_word_at_pos(position: Vector2): string
        
        /** Returns the line and column at the given position. In the returned vector, `x` is the column and `y` is the line.  
         *  If [param clamp_line] is `false` and [param position] is below the last line, `Vector2i(-1, -1)` is returned.  
         *  If [param clamp_column] is `false` and [param position] is outside the column range of the line, `Vector2i(-1, -1)` is returned.  
         */
        get_line_column_at_pos(position: Vector2i, clamp_line?: boolean /* = true */, clamp_column?: boolean /* = true */): Vector2i
        
        /** Returns the local position for the given [param line] and [param column]. If `x` or `y` of the returned vector equal `-1`, the position is outside of the viewable area of the control.  
         *      
         *  **Note:** The Y position corresponds to the bottom side of the line. Use [method get_rect_at_line_column] to get the top side position.  
         */
        get_pos_at_line_column(line: int64, column: int64): Vector2i
        
        /** Returns the local position and size for the grapheme at the given [param line] and [param column]. If `x` or `y` position of the returned rect equal `-1`, the position is outside of the viewable area of the control.  
         *      
         *  **Note:** The Y position of the returned rect corresponds to the top side of the line, unlike [method get_pos_at_line_column] which returns the bottom side.  
         */
        get_rect_at_line_column(line: int64, column: int64): Rect2i
        
        /** Returns the equivalent minimap line at [param position]. */
        get_minimap_line_at_pos(position: Vector2i): int64
        
        /** Returns `true` if the user is dragging their mouse for scrolling, selecting, or text dragging. */
        is_dragging_cursor(): boolean
        
        /** Returns `true` if the mouse is over a selection. If [param edges] is `true`, the edges are considered part of the selection. */
        is_mouse_over_selection(edges: boolean, caret_index?: int64 /* = -1 */): boolean
        
        /** Adds a new caret at the given location. Returns the index of the new caret, or `-1` if the location is invalid. */
        add_caret(line: int64, column: int64): int64
        
        /** Removes the given caret index.  
         *      
         *  **Note:** This can result in adjustment of all other caret indices.  
         */
        remove_caret(caret: int64): void
        
        /** Removes all additional carets. */
        remove_secondary_carets(): void
        
        /** Returns the number of carets in this [TextEdit]. */
        get_caret_count(): int64
        
        /** Adds an additional caret above or below every caret. If [param below] is `true` the new caret will be added below and above otherwise. */
        add_caret_at_carets(below: boolean): void
        
        /** Returns the carets sorted by selection beginning from lowest line and column to highest (from top to bottom of text).  
         *  If [param include_ignored_carets] is `false`, carets from [method multicaret_edit_ignore_caret] will be ignored.  
         */
        get_sorted_carets(include_ignored_carets?: boolean /* = false */): PackedInt32Array
        
        /** Collapse all carets in the given range to the [param from_line] and [param from_column] position.  
         *  [param inclusive] applies to both ends.  
         *  If [method is_in_mulitcaret_edit] is `true`, carets that are collapsed will be `true` for [method multicaret_edit_ignore_caret].  
         *  [method merge_overlapping_carets] will be called if any carets were collapsed.  
         */
        collapse_carets(from_line: int64, from_column: int64, to_line: int64, to_column: int64, inclusive?: boolean /* = false */): void
        
        /** Merges any overlapping carets. Will favor the newest caret, or the caret with a selection.  
         *  If [method is_in_mulitcaret_edit] is `true`, the merge will be queued to happen at the end of the multicaret edit. See [method begin_multicaret_edit] and [method end_multicaret_edit].  
         *      
         *  **Note:** This is not called when a caret changes position but after certain actions, so it is possible to get into a state where carets overlap.  
         */
        merge_overlapping_carets(): void
        
        /** Starts an edit for multiple carets. The edit must be ended with [method end_multicaret_edit]. Multicaret edits can be used to edit text at multiple carets and delay merging the carets until the end, so the caret indexes aren't affected immediately. [method begin_multicaret_edit] and [method end_multicaret_edit] can be nested, and the merge will happen at the last [method end_multicaret_edit].  
         *    
         */
        begin_multicaret_edit(): void
        
        /** Ends an edit for multiple carets, that was started with [method begin_multicaret_edit]. If this was the last [method end_multicaret_edit] and [method merge_overlapping_carets] was called, carets will be merged. */
        end_multicaret_edit(): void
        
        /** Returns `true` if a [method begin_multicaret_edit] has been called and [method end_multicaret_edit] has not yet been called. */
        is_in_mulitcaret_edit(): boolean
        
        /** Returns `true` if the given [param caret_index] should be ignored as part of a multicaret edit. See [method begin_multicaret_edit] and [method end_multicaret_edit]. Carets that should be ignored are ones that were part of removed text and will likely be merged at the end of the edit, or carets that were added during the edit.  
         *  It is recommended to `continue` within a loop iterating on multiple carets if a caret should be ignored.  
         */
        multicaret_edit_ignore_caret(caret_index: int64): boolean
        
        /** Returns `true` if the caret is visible, `false` otherwise. A caret will be considered hidden if it is outside the scrollable area when scrolling is enabled.  
         *      
         *  **Note:** [method is_caret_visible] does not account for a caret being off-screen if it is still within the scrollable area. It will return `true` even if the caret is off-screen as long as it meets [TextEdit]'s own conditions for being visible. This includes uses of [member scroll_fit_content_width] and [member scroll_fit_content_height] that cause the [TextEdit] to expand beyond the viewport's bounds.  
         */
        is_caret_visible(caret_index?: int64 /* = 0 */): boolean
        
        /** Returns the caret pixel draw position. */
        get_caret_draw_pos(caret_index?: int64 /* = 0 */): Vector2
        
        /** Moves the caret to the specified [param line] index. The caret column will be moved to the same visual position it was at the last time [method set_caret_column] was called, or clamped to the end of the line.  
         *  If [param adjust_viewport] is `true`, the viewport will center at the caret position after the move occurs.  
         *  If [param can_be_hidden] is `true`, the specified [param line] can be hidden.  
         *  If [param wrap_index] is `-1`, the caret column will be clamped to the [param line]'s length. If [param wrap_index] is greater than `-1`, the column will be moved to attempt to match the visual x position on the line's [param wrap_index] to the position from the last time [method set_caret_column] was called.  
         *      
         *  **Note:** If supporting multiple carets this will not check for any overlap. See [method merge_overlapping_carets].  
         */
        set_caret_line(line: int64, adjust_viewport?: boolean /* = true */, can_be_hidden?: boolean /* = true */, wrap_index?: int64 /* = 0 */, caret_index?: int64 /* = 0 */): void
        
        /** Returns the line the editing caret is on. */
        get_caret_line(caret_index?: int64 /* = 0 */): int64
        
        /** Moves the caret to the specified [param column] index.  
         *  If [param adjust_viewport] is `true`, the viewport will center at the caret position after the move occurs.  
         *      
         *  **Note:** If supporting multiple carets this will not check for any overlap. See [method merge_overlapping_carets].  
         */
        set_caret_column(column: int64, adjust_viewport?: boolean /* = true */, caret_index?: int64 /* = 0 */): void
        
        /** Returns the column the editing caret is at. */
        get_caret_column(caret_index?: int64 /* = 0 */): int64
        
        /** Returns the correct column at the end of a composite character like ❤️‍🩹 (mending heart; Unicode: `U+2764 U+FE0F U+200D U+1FA79`) which is comprised of more than one Unicode code point, if the caret is at the start of the composite character. Also returns the correct column with the caret at mid grapheme and for non-composite characters.  
         *      
         *  **Note:** To check at caret location use `get_next_composite_character_column(get_caret_line(), get_caret_column())`  
         */
        get_next_composite_character_column(line: int64, column: int64): int64
        
        /** Returns the correct column at the start of a composite character like ❤️‍🩹 (mending heart; Unicode: `U+2764 U+FE0F U+200D U+1FA79`) which is comprised of more than one Unicode code point, if the caret is at the end of the composite character. Also returns the correct column with the caret at mid grapheme and for non-composite characters.  
         *      
         *  **Note:** To check at caret location use `get_previous_composite_character_column(get_caret_line(), get_caret_column())`  
         */
        get_previous_composite_character_column(line: int64, column: int64): int64
        
        /** Returns the wrap index the editing caret is on. */
        get_caret_wrap_index(caret_index?: int64 /* = 0 */): int64
        
        /** Returns a [String] text with the word under the caret's location. */
        get_word_under_caret(caret_index?: int64 /* = -1 */): string
        
        /** Sets the current selection mode. */
        set_selection_mode(mode: TextEdit.SelectionMode): void
        
        /** Returns the current selection mode. */
        get_selection_mode(): TextEdit.SelectionMode
        
        /** Select all the text.  
         *  If [member selecting_enabled] is `false`, no selection will occur.  
         */
        select_all(): void
        
        /** Selects the word under the caret. */
        select_word_under_caret(caret_index?: int64 /* = -1 */): void
        
        /** Adds a selection and a caret for the next occurrence of the current selection. If there is no active selection, selects word under caret. */
        add_selection_for_next_occurrence(): void
        
        /** Moves a selection and a caret for the next occurrence of the current selection. If there is no active selection, moves to the next occurrence of the word under caret. */
        skip_selection_for_next_occurrence(): void
        
        /** Selects text from [param origin_line] and [param origin_column] to [param caret_line] and [param caret_column] for the given [param caret_index]. This moves the selection origin and the caret. If the positions are the same, the selection will be deselected.  
         *  If [member selecting_enabled] is `false`, no selection will occur.  
         *      
         *  **Note:** If supporting multiple carets this will not check for any overlap. See [method merge_overlapping_carets].  
         */
        select(origin_line: int64, origin_column: int64, caret_line: int64, caret_column: int64, caret_index?: int64 /* = 0 */): void
        
        /** Returns `true` if the user has selected text. */
        has_selection(caret_index?: int64 /* = -1 */): boolean
        
        /** Returns the text inside the selection of a caret, or all the carets if [param caret_index] is its default value `-1`. */
        get_selected_text(caret_index?: int64 /* = -1 */): string
        
        /** Returns the caret index of the selection at the given [param line] and [param column], or `-1` if there is none.  
         *  If [param include_edges] is `false`, the position must be inside the selection and not at either end. If [param only_selections] is `false`, carets without a selection will also be considered.  
         */
        get_selection_at_line_column(line: int64, column: int64, include_edges?: boolean /* = true */, only_selections?: boolean /* = true */): int64
        
        /** Returns an [Array] of line ranges where `x` is the first line and `y` is the last line. All lines within these ranges will have a caret on them or be part of a selection. Each line will only be part of one line range, even if it has multiple carets on it.  
         *  If a selection's end column ([method get_selection_to_column]) is at column `0`, that line will not be included. If a selection begins on the line after another selection ends and [param merge_adjacent] is `true`, or they begin and end on the same line, one line range will include both selections.  
         */
        get_line_ranges_from_carets(only_selections?: boolean /* = false */, merge_adjacent?: boolean /* = true */): GArray<Vector2i>
        
        /** Returns the origin line of the selection. This is the opposite end from the caret. */
        get_selection_origin_line(caret_index?: int64 /* = 0 */): int64
        
        /** Returns the origin column of the selection. This is the opposite end from the caret. */
        get_selection_origin_column(caret_index?: int64 /* = 0 */): int64
        
        /** Sets the selection origin line to the [param line] for the given [param caret_index]. If the selection origin is moved to the caret position, the selection will deselect.  
         *  If [param can_be_hidden] is `false`, The line will be set to the nearest unhidden line below or above.  
         *  If [param wrap_index] is `-1`, the selection origin column will be clamped to the [param line]'s length. If [param wrap_index] is greater than `-1`, the column will be moved to attempt to match the visual x position on the line's [param wrap_index] to the position from the last time [method set_selection_origin_column] or [method select] was called.  
         */
        set_selection_origin_line(line: int64, can_be_hidden?: boolean /* = true */, wrap_index?: int64 /* = -1 */, caret_index?: int64 /* = 0 */): void
        
        /** Sets the selection origin column to the [param column] for the given [param caret_index]. If the selection origin is moved to the caret position, the selection will deselect. */
        set_selection_origin_column(column: int64, caret_index?: int64 /* = 0 */): void
        
        /** Returns the selection begin line. Returns the caret line if there is no selection. */
        get_selection_from_line(caret_index?: int64 /* = 0 */): int64
        
        /** Returns the selection begin column. Returns the caret column if there is no selection. */
        get_selection_from_column(caret_index?: int64 /* = 0 */): int64
        
        /** Returns the selection end line. Returns the caret line if there is no selection. */
        get_selection_to_line(caret_index?: int64 /* = 0 */): int64
        
        /** Returns the selection end column. Returns the caret column if there is no selection. */
        get_selection_to_column(caret_index?: int64 /* = 0 */): int64
        
        /** Returns `true` if the caret of the selection is after the selection origin. This can be used to determine the direction of the selection. */
        is_caret_after_selection_origin(caret_index?: int64 /* = 0 */): boolean
        
        /** Deselects the current selection. */
        deselect(caret_index?: int64 /* = -1 */): void
        
        /** Deletes the selected text. */
        delete_selection(caret_index?: int64 /* = -1 */): void
        
        /** Returns if the given line is wrapped. */
        is_line_wrapped(line: int64): boolean
        
        /** Returns the number of times the given line is wrapped. */
        get_line_wrap_count(line: int64): int64
        
        /** Returns the wrap index of the given column on the given line. This ranges from `0` to [method get_line_wrap_count]. */
        get_line_wrap_index_at_column(line: int64, column: int64): int64
        
        /** Returns an array of [String]s representing each wrapped index. */
        get_line_wrapped_text(line: int64): PackedStringArray
        
        /** Returns the [VScrollBar] of the [TextEdit]. */
        get_v_scroll_bar(): null | VScrollBar
        
        /** Returns the [HScrollBar] used by [TextEdit]. */
        get_h_scroll_bar(): null | HScrollBar
        
        /** Returns the scroll position for [param wrap_index] of [param line]. */
        get_scroll_pos_for_line(line: int64, wrap_index?: int64 /* = 0 */): float64
        
        /** Positions the [param wrap_index] of [param line] at the top of the viewport. */
        set_line_as_first_visible(line: int64, wrap_index?: int64 /* = 0 */): void
        
        /** Returns the first visible line. */
        get_first_visible_line(): int64
        
        /** Positions the [param wrap_index] of [param line] at the center of the viewport. */
        set_line_as_center_visible(line: int64, wrap_index?: int64 /* = 0 */): void
        
        /** Positions the [param wrap_index] of [param line] at the bottom of the viewport. */
        set_line_as_last_visible(line: int64, wrap_index?: int64 /* = 0 */): void
        
        /** Returns the last visible line. Use [method get_last_full_visible_line_wrap_index] for the wrap index. */
        get_last_full_visible_line(): int64
        
        /** Returns the last visible wrap index of the last visible line. */
        get_last_full_visible_line_wrap_index(): int64
        
        /** Returns the number of lines that can visually fit, rounded down, based on this control's height. */
        get_visible_line_count(): int64
        
        /** Returns the total number of lines between [param from_line] and [param to_line] (inclusive) in the text. This includes wrapped lines and excludes folded lines. If the range covers all lines it is equivalent to [method get_total_visible_line_count]. */
        get_visible_line_count_in_range(from_line: int64, to_line: int64): int64
        
        /** Returns the total number of lines in the text. This includes wrapped lines and excludes folded lines. If [member wrap_mode] is set to [constant LINE_WRAPPING_NONE] and no lines are folded (see [method CodeEdit.is_line_folded]) then this is equivalent to [method get_line_count]. See [method get_visible_line_count_in_range] for a limited range of lines. */
        get_total_visible_line_count(): int64
        
        /** Adjust the viewport so the caret is visible. */
        adjust_viewport_to_caret(caret_index?: int64 /* = 0 */): void
        
        /** Centers the viewport on the line the editing caret is at. This also resets the [member scroll_horizontal] value to `0`. */
        center_viewport_to_caret(caret_index?: int64 /* = 0 */): void
        
        /** Returns the number of lines that may be drawn on the minimap. */
        get_minimap_visible_lines(): int64
        
        /** Register a new gutter to this [TextEdit]. Use [param at] to have a specific gutter order. A value of `-1` appends the gutter to the right. */
        add_gutter(at?: int64 /* = -1 */): void
        
        /** Removes the gutter at the given index. */
        remove_gutter(gutter: int64): void
        
        /** Returns the number of gutters registered. */
        get_gutter_count(): int64
        
        /** Sets the name of the gutter at the given index. */
        set_gutter_name(gutter: int64, name: string): void
        
        /** Returns the name of the gutter at the given index. */
        get_gutter_name(gutter: int64): string
        
        /** Sets the type of gutter at the given index. Gutters can contain icons, text, or custom visuals. */
        set_gutter_type(gutter: int64, type: TextEdit.GutterType): void
        
        /** Returns the type of the gutter at the given index. Gutters can contain icons, text, or custom visuals. */
        get_gutter_type(gutter: int64): TextEdit.GutterType
        
        /** Set the width of the gutter at the given index. */
        set_gutter_width(gutter: int64, width: int64): void
        
        /** Returns the width of the gutter at the given index. */
        get_gutter_width(gutter: int64): int64
        
        /** If `true`, the gutter at the given index is drawn. The gutter type ([method set_gutter_type]) determines how it is drawn. See [method is_gutter_drawn]. */
        set_gutter_draw(gutter: int64, draw: boolean): void
        
        /** Returns `true` if the gutter at the given index is currently drawn. See [method set_gutter_draw]. */
        is_gutter_drawn(gutter: int64): boolean
        
        /** If `true`, the mouse cursor will change to a pointing hand ([constant Control.CURSOR_POINTING_HAND]) when hovering over the gutter at the given index. See [method is_gutter_clickable] and [method set_line_gutter_clickable]. */
        set_gutter_clickable(gutter: int64, clickable: boolean): void
        
        /** Returns `true` if the gutter at the given index is clickable. See [method set_gutter_clickable]. */
        is_gutter_clickable(gutter: int64): boolean
        
        /** If `true`, the line data of the gutter at the given index can be overridden when using [method merge_gutters]. See [method is_gutter_overwritable]. */
        set_gutter_overwritable(gutter: int64, overwritable: boolean): void
        
        /** Returns `true` if the gutter at the given index is overwritable. See [method set_gutter_overwritable]. */
        is_gutter_overwritable(gutter: int64): boolean
        
        /** Merge the gutters from [param from_line] into [param to_line]. Only overwritable gutters will be copied. See [method set_gutter_overwritable]. */
        merge_gutters(from_line: int64, to_line: int64): void
        
        /** Set a custom draw callback for the gutter at the given index. [param draw_callback] must take the following arguments: A line index [int], a gutter index [int], and an area [Rect2]. This callback only works when the gutter type is [constant GUTTER_TYPE_CUSTOM] (see [method set_gutter_type]). */
        set_gutter_custom_draw(column: int64, draw_callback: Callable): void
        
        /** Returns the total width of all gutters and internal padding. */
        get_total_gutter_width(): int64
        
        /** Sets the metadata for [param gutter] on [param line] to [param metadata]. */
        set_line_gutter_metadata(line: int64, gutter: int64, metadata: any): void
        
        /** Returns the metadata currently in [param gutter] at [param line]. */
        get_line_gutter_metadata(line: int64, gutter: int64): any
        
        /** Sets the text for [param gutter] on [param line] to [param text]. This only works when the gutter type is [constant GUTTER_TYPE_STRING] (see [method set_gutter_type]). */
        set_line_gutter_text(line: int64, gutter: int64, text: string): void
        
        /** Returns the text currently in [param gutter] at [param line]. This only works when the gutter type is [constant GUTTER_TYPE_STRING] (see [method set_gutter_type]). */
        get_line_gutter_text(line: int64, gutter: int64): string
        
        /** Sets the icon for [param gutter] on [param line] to [param icon]. This only works when the gutter type is [constant GUTTER_TYPE_ICON] (see [method set_gutter_type]). */
        set_line_gutter_icon(line: int64, gutter: int64, icon: Texture2D): void
        
        /** Returns the icon currently in [param gutter] at [param line]. This only works when the gutter type is [constant GUTTER_TYPE_ICON] (see [method set_gutter_type]). */
        get_line_gutter_icon(line: int64, gutter: int64): null | Texture2D
        
        /** Sets the color for [param gutter] on [param line] to [param color]. */
        set_line_gutter_item_color(line: int64, gutter: int64, color: Color): void
        
        /** Returns the color currently in [param gutter] at [param line]. */
        get_line_gutter_item_color(line: int64, gutter: int64): Color
        
        /** If [param clickable] is `true`, makes the [param gutter] on the given [param line] clickable. This is like [method set_gutter_clickable], but for a single line. If [method is_gutter_clickable] is `true`, this will not have any effect. See [method is_line_gutter_clickable] and [signal gutter_clicked]. */
        set_line_gutter_clickable(line: int64, gutter: int64, clickable: boolean): void
        
        /** Returns `true` if the gutter at the given index on the given line is clickable. See [method set_line_gutter_clickable]. */
        is_line_gutter_clickable(line: int64, gutter: int64): boolean
        
        /** Sets the custom background color of the given line. If transparent, this color is applied on top of the default background color (See [theme_item background_color]). If set to `Color(0, 0, 0, 0)`, no additional color is applied. */
        set_line_background_color(line: int64, color: Color): void
        
        /** Returns the custom background color of the given line. If no color is set, returns `Color(0, 0, 0, 0)`. */
        get_line_background_color(line: int64): Color
        
        /** Returns the [PopupMenu] of this [TextEdit]. By default, this menu is displayed when right-clicking on the [TextEdit].  
         *  You can add custom menu items or remove standard ones. Make sure your IDs don't conflict with the standard ones (see [enum MenuItems]). For example:  
         *    
         *  **Warning:** This is a required internal node, removing and freeing it may cause a crash. If you wish to hide it or any of its children, use their [member Window.visible] property.  
         */
        get_menu(): null | PopupMenu
        
        /** Returns `true` if the menu is visible. Use this instead of `get_menu().visible` to improve performance (so the creation of the menu is avoided). See [method get_menu]. */
        is_menu_visible(): boolean
        
        /** Executes a given action as defined in the [enum MenuItems] enum. */
        menu_option(option: int64): void
        
        /** This method does nothing. */
        adjust_carets_after_edit(caret: int64, from_line: int64, from_col: int64, to_line: int64, to_col: int64): void
        
        /** Returns a list of caret indexes in their edit order, this done from bottom to top. Edit order refers to the way actions such as [method insert_text_at_caret] are applied. */
        get_caret_index_edit_order(): PackedInt32Array
        
        /** Returns the original start line of the selection. */
        get_selection_line(caret_index?: int64 /* = 0 */): int64
        
        /** Returns the original start column of the selection. */
        get_selection_column(caret_index?: int64 /* = 0 */): int64
        
        /** String value of the [TextEdit]. */
        get text(): string
        set text(value: string)
        
        /** Text shown when the [TextEdit] is empty. It is **not** the [TextEdit]'s default value (see [member text]). */
        get placeholder_text(): string
        set placeholder_text(value: string)
        
        /** If `false`, existing text cannot be modified and new text cannot be added. */
        get editable(): boolean
        set editable(value: boolean)
        
        /** If `true`, a right-click displays the context menu. */
        get context_menu_enabled(): boolean
        set context_menu_enabled(value: boolean)
        
        /** If `true`, "Emoji and Symbols" menu is enabled. */
        get emoji_menu_enabled(): boolean
        set emoji_menu_enabled(value: boolean)
        
        /** If `true` and [member caret_mid_grapheme] is `false`, backspace deletes an entire composite character such as ❤️‍🩹, instead of deleting part of the composite character. */
        get backspace_deletes_composite_character_enabled(): boolean
        set backspace_deletes_composite_character_enabled(value: boolean)
        
        /** If `true`, shortcut keys for context menu items are enabled, even if the context menu is disabled. */
        get shortcut_keys_enabled(): boolean
        set shortcut_keys_enabled(value: boolean)
        
        /** If `true`, text can be selected.  
         *  If `false`, text can not be selected by the user or by the [method select] or [method select_all] methods.  
         */
        get selecting_enabled(): boolean
        set selecting_enabled(value: boolean)
        
        /** If `true`, the selected text will be deselected when focus is lost. */
        get deselect_on_focus_loss_enabled(): boolean
        set deselect_on_focus_loss_enabled(value: boolean)
        
        /** If `true`, allow drag and drop of selected text. Text can still be dropped from other sources. */
        get drag_and_drop_selection_enabled(): boolean
        set drag_and_drop_selection_enabled(value: boolean)
        
        /** If `false`, using middle mouse button to paste clipboard will be disabled.  
         *      
         *  **Note:** This method is only implemented on Linux.  
         */
        get middle_mouse_paste_enabled(): boolean
        set middle_mouse_paste_enabled(value: boolean)
        
        /** If `true`, copying or cutting without a selection is performed on all lines with a caret. Otherwise, copy and cut require a selection. */
        get empty_selection_clipboard_enabled(): boolean
        set empty_selection_clipboard_enabled(value: boolean)
        
        /** Sets the line wrapping mode to use. */
        get wrap_mode(): int64
        set wrap_mode(value: int64)
        
        /** If [member wrap_mode] is set to [constant LINE_WRAPPING_BOUNDARY], sets text wrapping mode. */
        get autowrap_mode(): int64
        set autowrap_mode(value: int64)
        
        /** If `true`, all wrapped lines are indented to the same amount as the unwrapped line. */
        get indent_wrapped_lines(): boolean
        set indent_wrapped_lines(value: boolean)
        
        /** If `true`, [member ProjectSettings.input/ui_text_indent] input `Tab` character, otherwise it moves keyboard focus to the next [Control] in the scene. */
        get tab_input_mode(): boolean
        set tab_input_mode(value: boolean)
        
        /** If `true`, the native virtual keyboard is enabled on platforms that support it. */
        get virtual_keyboard_enabled(): boolean
        set virtual_keyboard_enabled(value: boolean)
        
        /** If `true`, the native virtual keyboard is shown on focus events on platforms that support it. */
        get virtual_keyboard_show_on_focus(): boolean
        set virtual_keyboard_show_on_focus(value: boolean)
        
        /** Scroll smoothly over the text rather than jumping to the next location. */
        get scroll_smooth(): boolean
        set scroll_smooth(value: boolean)
        
        /** Sets the scroll speed with the minimap or when [member scroll_smooth] is enabled. */
        get scroll_v_scroll_speed(): float64
        set scroll_v_scroll_speed(value: float64)
        
        /** Allow scrolling past the last line into "virtual" space. */
        get scroll_past_end_of_file(): boolean
        set scroll_past_end_of_file(value: boolean)
        
        /** If there is a vertical scrollbar, this determines the current vertical scroll value in line numbers, starting at 0 for the top line. */
        get scroll_vertical(): float64
        set scroll_vertical(value: float64)
        
        /** If there is a horizontal scrollbar, this determines the current horizontal scroll value in pixels. */
        get scroll_horizontal(): int64
        set scroll_horizontal(value: int64)
        
        /** If `true`, [TextEdit] will disable vertical scroll and fit minimum height to the number of visible lines. When both this property and [member scroll_fit_content_width] are `true`, no scrollbars will be displayed. */
        get scroll_fit_content_height(): boolean
        set scroll_fit_content_height(value: boolean)
        
        /** If `true`, [TextEdit] will disable horizontal scroll and fit minimum width to the widest line in the text. When both this property and [member scroll_fit_content_height] are `true`, no scrollbars will be displayed. */
        get scroll_fit_content_width(): boolean
        set scroll_fit_content_width(value: boolean)
        
        /** If `true`, a minimap is shown, providing an outline of your source code. The minimap uses a fixed-width text size. */
        get minimap_draw(): boolean
        set minimap_draw(value: boolean)
        
        /** The width, in pixels, of the minimap. */
        get minimap_width(): int64
        set minimap_width(value: int64)
        
        /** Set the type of caret to draw. */
        get caret_type(): int64
        set caret_type(value: int64)
        
        /** If `true`, makes the caret blink. */
        get caret_blink(): boolean
        set caret_blink(value: boolean)
        
        /** The interval at which the caret blinks (in seconds). */
        get caret_blink_interval(): float64
        set caret_blink_interval(value: float64)
        
        /** If `true`, caret will be visible when [member editable] is disabled. */
        get caret_draw_when_editable_disabled(): boolean
        set caret_draw_when_editable_disabled(value: boolean)
        
        /** If `true`, a right-click moves the caret at the mouse position before displaying the context menu.  
         *  If `false`, the context menu ignores mouse location.  
         */
        get caret_move_on_right_click(): boolean
        set caret_move_on_right_click(value: boolean)
        
        /** Allow moving caret, selecting and removing the individual composite character components.  
         *      
         *  **Note:** [kbd]Backspace[/kbd] is always removing individual composite character components.  
         */
        get caret_mid_grapheme(): boolean
        set caret_mid_grapheme(value: boolean)
        
        /** If `true`, multiple carets are allowed. Left-clicking with [kbd]Alt[/kbd] adds a new caret. See [method add_caret] and [method get_caret_count]. */
        get caret_multiple(): boolean
        set caret_multiple(value: boolean)
        
        /** If `false`, using [kbd]Ctrl + Left[/kbd] or [kbd]Ctrl + Right[/kbd] ([kbd]Cmd + Left[/kbd] or [kbd]Cmd + Right[/kbd] on macOS) bindings will stop moving caret only if a space or punctuation is detected. If `true`, it will also stop the caret if a character is part of `!"#$%&'()*+,-./:;<=>?@[\]^`{|}~`, the Unicode General Punctuation table, or the Unicode CJK Punctuation table. Useful for subword moving. This behavior also will be applied to the behavior of text selection. */
        get use_default_word_separators(): boolean
        set use_default_word_separators(value: boolean)
        
        /** If `false`, using [kbd]Ctrl + Left[/kbd] or [kbd]Ctrl + Right[/kbd] ([kbd]Cmd + Left[/kbd] or [kbd]Cmd + Right[/kbd] on macOS) bindings will use the behavior of [member use_default_word_separators]. If `true`, it will also stop the caret if a character within [member custom_word_separators] is detected. Useful for subword moving. This behavior also will be applied to the behavior of text selection. */
        get use_custom_word_separators(): boolean
        set use_custom_word_separators(value: boolean)
        
        /** The characters to consider as word delimiters if [member use_custom_word_separators] is `true`. The characters should be defined without separation, for example `#_!`. */
        get custom_word_separators(): string
        set custom_word_separators(value: string)
        
        /** The syntax highlighter to use.  
         *      
         *  **Note:** A [SyntaxHighlighter] instance should not be used across multiple [TextEdit] nodes.  
         */
        get syntax_highlighter(): null | SyntaxHighlighter
        set syntax_highlighter(value: null | SyntaxHighlighter)
        
        /** If `true`, all occurrences of the selected text will be highlighted. */
        get highlight_all_occurrences(): boolean
        set highlight_all_occurrences(value: boolean)
        
        /** If `true`, the line containing the cursor is highlighted. */
        get highlight_current_line(): boolean
        set highlight_current_line(value: boolean)
        
        /** If `true`, control characters are displayed. */
        get draw_control_chars(): boolean
        set draw_control_chars(value: boolean)
        
        /** If `true`, the "tab" character will have a visible representation. */
        get draw_tabs(): boolean
        set draw_tabs(value: boolean)
        
        /** If `true`, the "space" character will have a visible representation. */
        get draw_spaces(): boolean
        set draw_spaces(value: boolean)
        
        /** Base text writing direction. */
        get text_direction(): int64
        set text_direction(value: int64)
        
        /** Language code used for line-breaking and text shaping algorithms. If left empty, the current locale is used instead. */
        get language(): string
        set language(value: string)
        
        /** Set BiDi algorithm override for the structured text. */
        get structured_text_bidi_override(): int64
        set structured_text_bidi_override(value: int64)
        
        /** Set additional options for BiDi override. */
        get structured_text_bidi_override_options(): GArray
        set structured_text_bidi_override_options(value: GArray)
        
        /** Emitted when [method clear] is called or [member text] is set. */
        readonly text_set: Signal<() => void>
        
        /** Emitted when the text changes. */
        readonly text_changed: Signal<() => void>
        
        /** Emitted immediately when the text changes.  
         *  When text is added [param from_line] will be less than [param to_line]. On a remove [param to_line] will be less than [param from_line].  
         */
        readonly lines_edited_from: Signal<(from_line: int64, to_line: int64) => void>
        
        /** Emitted when any caret changes position. */
        readonly caret_changed: Signal<() => void>
        
        /** Emitted when a gutter is clicked. */
        readonly gutter_clicked: Signal<(line: int64, gutter: int64) => void>
        
        /** Emitted when a gutter is added. */
        readonly gutter_added: Signal<() => void>
        
        /** Emitted when a gutter is removed. */
        readonly gutter_removed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextEdit;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextLine extends __NameMapRefCounted {
    }
    /** Holds a line of text.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textline.html  
     */
    class TextLine extends RefCounted {
        constructor(identifier?: any)
        /** Clears text line (removes text and inline objects). */
        clear(): void
        
        /** Duplicates this [TextLine]. */
        duplicate(): null | TextLine
        
        /** Returns the text writing direction inferred by the BiDi algorithm. */
        get_inferred_direction(): TextServer.Direction
        
        /** Overrides BiDi for the structured text.  
         *  Override ranges should cover full source text without overlaps. BiDi algorithm will be used on each range separately.  
         */
        set_bidi_override(override: GArray): void
        
        /** Adds text span and font to draw it. */
        add_string(text: string, font: Font, font_size: int64, language?: string /* = '' */, meta?: any /* = {} */): boolean
        
        /** Adds inline object to the text buffer, [param key] must be unique. In the text, object is represented as [param length] object replacement characters. */
        add_object(key: any, size: Vector2, inline_align?: InlineAlignment /* = 5 */, length?: int64 /* = 1 */, baseline?: float64 /* = 0 */): boolean
        
        /** Sets new size and alignment of embedded object. */
        resize_object(key: any, size: Vector2, inline_align?: InlineAlignment /* = 5 */, baseline?: float64 /* = 0 */): boolean
        
        /** Returns `true` if an object with [param key] is embedded in this line. */
        has_object(key: any): boolean
        
        /** Aligns text to the given tab-stops. */
        tab_align(tab_stops: PackedFloat32Array | float32[]): void
        
        /** Returns array of inline objects. */
        get_objects(): GArray
        
        /** Returns bounding rectangle of the inline object. */
        get_object_rect(key: any): Rect2
        
        /** Returns size of the bounding box of the text. */
        get_size(): Vector2
        
        /** Returns TextServer buffer RID. */
        get_rid(): RID
        
        /** Returns the text ascent (number of pixels above the baseline for horizontal layout or to the left of baseline for vertical). */
        get_line_ascent(): float64
        
        /** Returns the text descent (number of pixels below the baseline for horizontal layout or to the right of baseline for vertical). */
        get_line_descent(): float64
        
        /** Returns width (for horizontal layout) or height (for vertical) of the text. */
        get_line_width(): float64
        
        /** Returns pixel offset of the underline below the baseline. */
        get_line_underline_position(): float64
        
        /** Returns thickness of the underline. */
        get_line_underline_thickness(): float64
        
        /** Draw text into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw(canvas: RID, pos: Vector2, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw text into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw_outline(canvas: RID, pos: Vector2, outline_size?: int64 /* = 1 */, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Returns caret character offset at the specified pixel offset at the baseline. This function always returns a valid position. */
        hit_test(coords: float64): int64
        
        /** Text writing direction. */
        get direction(): int64
        set direction(value: int64)
        
        /** Text orientation. */
        get orientation(): int64
        set orientation(value: int64)
        
        /** If set to `true` text will display invalid characters. */
        get preserve_invalid(): boolean
        set preserve_invalid(value: boolean)
        
        /** If set to `true` text will display control characters. */
        get preserve_control(): boolean
        set preserve_control(value: boolean)
        
        /** Text line width. */
        get width(): float64
        set width(value: float64)
        
        /** Sets text alignment within the line as if the line was horizontal. */
        get alignment(): int64
        set alignment(value: int64)
        
        /** Line alignment rules. For more info see [TextServer]. */
        get flags(): int64
        set flags(value: int64)
        
        /** The clipping behavior when the text exceeds the text line's set width. */
        get text_overrun_behavior(): int64
        set text_overrun_behavior(value: int64)
        
        /** Ellipsis character used for text clipping. */
        get ellipsis_char(): string
        set ellipsis_char(value: string)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextLine;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextMesh extends __NameMapPrimitiveMesh {
    }
    /** Generate a [PrimitiveMesh] from the text.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textmesh.html  
     */
    class TextMesh extends PrimitiveMesh {
        constructor(identifier?: any)
        /** The text to generate mesh from.  
         *      
         *  **Note:** Due to being a [Resource], it doesn't follow the rules of [member Node.auto_translate_mode]. If disabling translation is desired, it should be done manually with [method Object.set_message_translation].  
         */
        get text(): string
        set text(value: string)
        
        /** Font configuration used to display text. */
        get font(): null | Font
        set font(value: null | Font)
        
        /** Font size of the [TextMesh]'s text. This property works in tandem with [member pixel_size]. Higher values will result in a more detailed font, regardless of [member curve_step] and [member pixel_size]. Consider keeping this value below 63 (inclusive) for good performance, and adjust [member pixel_size] as needed to enlarge text.  
         *      
         *  **Note:** Changing this property will regenerate the mesh, which is a slow operation, especially with large font sizes and long texts. To change the text's size in real-time efficiently, change the node's [member Node3D.scale] instead.  
         */
        get font_size(): int64
        set font_size(value: int64)
        
        /** Controls the text's horizontal alignment. Supports left, center, right, and fill (also known as justify). */
        get horizontal_alignment(): int64
        set horizontal_alignment(value: int64)
        
        /** Controls the text's vertical alignment. Supports top, center, and bottom. */
        get vertical_alignment(): int64
        set vertical_alignment(value: int64)
        
        /** If `true`, all the text displays as UPPERCASE. */
        get uppercase(): boolean
        set uppercase(value: boolean)
        
        /** Additional vertical spacing between lines (in pixels), spacing is added to line descent. This value can be negative. */
        get line_spacing(): float64
        set line_spacing(value: float64)
        
        /** If set to something other than [constant TextServer.AUTOWRAP_OFF], the text gets wrapped inside the node's bounding rectangle. If you resize the node, it will change its height automatically to show all the text. */
        get autowrap_mode(): int64
        set autowrap_mode(value: int64)
        
        /** Line fill alignment rules. */
        get justification_flags(): int64
        set justification_flags(value: int64)
        
        /** The size of one pixel's width on the text to scale it in 3D. This property works in tandem with [member font_size].  
         *      
         *  **Note:** Changing this property will regenerate the mesh, which is a slow operation, especially with large font sizes and long texts. To change the text's size in real-time efficiently, change the node's [member Node3D.scale] instead.  
         */
        get pixel_size(): float64
        set pixel_size(value: float64)
        
        /** Step (in pixels) used to approximate Bézier curves. Lower values result in smoother curves, but is slower to generate and render. Consider adjusting this according to the font size and the typical viewing distance.  
         *      
         *  **Note:** Changing this property will regenerate the mesh, which is a slow operation, especially with large font sizes and long texts.  
         */
        get curve_step(): float64
        set curve_step(value: float64)
        
        /** Depths of the mesh, if set to `0.0` only front surface, is generated, and UV layout is changed to use full texture for the front face only. */
        get depth(): float64
        set depth(value: float64)
        
        /** Text width (in pixels), used for fill alignment. */
        get width(): float64
        set width(value: float64)
        
        /** The text drawing offset (in pixels).  
         *      
         *  **Note:** Changing this property will regenerate the mesh, which is a slow operation. To change the text's position in real-time efficiently, change the node's [member Node3D.position] instead.  
         */
        get offset(): Vector2
        set offset(value: Vector2)
        
        /** Base text writing direction. */
        get text_direction(): int64
        set text_direction(value: int64)
        
        /** Language code used for line-breaking and text shaping algorithms. If left empty, the current locale is used instead. */
        get language(): string
        set language(value: string)
        
        /** Set BiDi algorithm override for the structured text. */
        get structured_text_bidi_override(): int64
        set structured_text_bidi_override(value: int64)
        
        /** Set additional options for BiDi override. */
        get structured_text_bidi_override_options(): GArray
        set structured_text_bidi_override_options(value: GArray)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextMesh;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextParagraph extends __NameMapRefCounted {
    }
    /** Holds a paragraph of text.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textparagraph.html  
     */
    class TextParagraph extends RefCounted {
        constructor(identifier?: any)
        /** Clears text paragraph (removes text and inline objects). */
        clear(): void
        
        /** Duplicates this [TextParagraph]. */
        duplicate(): null | TextParagraph
        
        /** Returns the text writing direction inferred by the BiDi algorithm. */
        get_inferred_direction(): TextServer.Direction
        
        /** Overrides BiDi for the structured text.  
         *  Override ranges should cover full source text without overlaps. BiDi algorithm will be used on each range separately.  
         */
        set_bidi_override(override: GArray): void
        
        /** Sets drop cap, overrides previously set drop cap. Drop cap (dropped capital) is a decorative element at the beginning of a paragraph that is larger than the rest of the text. */
        set_dropcap(text: string, font: Font, font_size: int64, dropcap_margins?: Rect2 /* = new Rect2(0, 0, 0, 0) */, language?: string /* = '' */): boolean
        
        /** Removes dropcap. */
        clear_dropcap(): void
        
        /** Adds text span and font to draw it. */
        add_string(text: string, font: Font, font_size: int64, language?: string /* = '' */, meta?: any /* = {} */): boolean
        
        /** Adds inline object to the text buffer, [param key] must be unique. In the text, object is represented as [param length] object replacement characters. */
        add_object(key: any, size: Vector2, inline_align?: InlineAlignment /* = 5 */, length?: int64 /* = 1 */, baseline?: float64 /* = 0 */): boolean
        
        /** Sets new size and alignment of embedded object. */
        resize_object(key: any, size: Vector2, inline_align?: InlineAlignment /* = 5 */, baseline?: float64 /* = 0 */): boolean
        
        /** Returns `true` if an object with [param key] is embedded in this shaped text buffer. */
        has_object(key: any): boolean
        
        /** Aligns paragraph to the given tab-stops. */
        tab_align(tab_stops: PackedFloat32Array | float32[]): void
        
        /** Returns the size of the bounding box of the paragraph, without line breaks. */
        get_non_wrapped_size(): Vector2
        
        /** Returns the size of the bounding box of the paragraph. */
        get_size(): Vector2
        
        /** Returns TextServer full string buffer RID. */
        get_rid(): RID
        
        /** Returns TextServer line buffer RID. */
        get_line_rid(line: int64): RID
        
        /** Returns drop cap text buffer RID. */
        get_dropcap_rid(): RID
        
        /** Returns the character range of the paragraph. */
        get_range(): Vector2i
        
        /** Returns number of lines in the paragraph. */
        get_line_count(): int64
        
        /** Returns array of inline objects in the line. */
        get_line_objects(line: int64): GArray
        
        /** Returns bounding rectangle of the inline object. */
        get_line_object_rect(line: int64, key: any): Rect2
        
        /** Returns size of the bounding box of the line of text. Returned size is rounded up. */
        get_line_size(line: int64): Vector2
        
        /** Returns character range of the line. */
        get_line_range(line: int64): Vector2i
        
        /** Returns the text line ascent (number of pixels above the baseline for horizontal layout or to the left of baseline for vertical). */
        get_line_ascent(line: int64): float64
        
        /** Returns the text line descent (number of pixels below the baseline for horizontal layout or to the right of baseline for vertical). */
        get_line_descent(line: int64): float64
        
        /** Returns width (for horizontal layout) or height (for vertical) of the line of text. */
        get_line_width(line: int64): float64
        
        /** Returns pixel offset of the underline below the baseline. */
        get_line_underline_position(line: int64): float64
        
        /** Returns thickness of the underline. */
        get_line_underline_thickness(line: int64): float64
        
        /** Returns drop cap bounding box size. */
        get_dropcap_size(): Vector2
        
        /** Returns number of lines used by dropcap. */
        get_dropcap_lines(): int64
        
        /** Draw all lines of the text and drop cap into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw(canvas: RID, pos: Vector2, color?: Color /* = new Color(1, 1, 1, 1) */, dc_color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw outlines of all lines of the text and drop cap into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw_outline(canvas: RID, pos: Vector2, outline_size?: int64 /* = 1 */, color?: Color /* = new Color(1, 1, 1, 1) */, dc_color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw single line of text into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw_line(canvas: RID, pos: Vector2, line: int64, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw outline of the single line of text into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw_line_outline(canvas: RID, pos: Vector2, line: int64, outline_size?: int64 /* = 1 */, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw drop cap into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw_dropcap(canvas: RID, pos: Vector2, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw drop cap outline into a canvas item at a given position, with [param color]. [param pos] specifies the top left corner of the bounding box. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        draw_dropcap_outline(canvas: RID, pos: Vector2, outline_size?: int64 /* = 1 */, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Returns caret character offset at the specified coordinates. This function always returns a valid position. */
        hit_test(coords: Vector2): int64
        
        /** Text writing direction. */
        get direction(): int64
        set direction(value: int64)
        
        /** Custom punctuation character list, used for word breaking. If set to empty string, server defaults are used. */
        get custom_punctuation(): string
        set custom_punctuation(value: string)
        
        /** Text orientation. */
        get orientation(): int64
        set orientation(value: int64)
        
        /** If set to `true` text will display invalid characters. */
        get preserve_invalid(): boolean
        set preserve_invalid(value: boolean)
        
        /** If set to `true` text will display control characters. */
        get preserve_control(): boolean
        set preserve_control(value: boolean)
        
        /** Paragraph horizontal alignment. */
        get alignment(): int64
        set alignment(value: int64)
        
        /** Line breaking rules. For more info see [TextServer]. */
        get break_flags(): int64
        set break_flags(value: int64)
        
        /** Line fill alignment rules. */
        get justification_flags(): int64
        set justification_flags(value: int64)
        
        /** The clipping behavior when the text exceeds the paragraph's set width. */
        get text_overrun_behavior(): int64
        set text_overrun_behavior(value: int64)
        
        /** Ellipsis character used for text clipping. */
        get ellipsis_char(): string
        set ellipsis_char(value: string)
        
        /** Paragraph width. */
        get width(): float64
        set width(value: float64)
        
        /** Limits the lines of text shown. */
        get max_lines_visible(): int64
        set max_lines_visible(value: int64)
        
        /** Additional vertical spacing between lines (in pixels), spacing is added to line descent. This value can be negative. */
        get line_spacing(): float64
        set line_spacing(value: float64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextParagraph;
    }
    namespace TextServer {
        enum FontAntialiasing {
            /** Font glyphs are rasterized as 1-bit bitmaps. */
            FONT_ANTIALIASING_NONE = 0,
            
            /** Font glyphs are rasterized as 8-bit grayscale anti-aliased bitmaps. */
            FONT_ANTIALIASING_GRAY = 1,
            
            /** Font glyphs are rasterized for LCD screens.  
             *  LCD subpixel layout is determined by the value of the [member ProjectSettings.gui/theme/lcd_subpixel_layout] setting.  
             *  LCD subpixel anti-aliasing mode is suitable only for rendering horizontal, unscaled text in 2D.  
             */
            FONT_ANTIALIASING_LCD = 2,
        }
        enum FontLCDSubpixelLayout {
            /** Unknown or unsupported subpixel layout, LCD subpixel antialiasing is disabled. */
            FONT_LCD_SUBPIXEL_LAYOUT_NONE = 0,
            
            /** Horizontal RGB subpixel layout. */
            FONT_LCD_SUBPIXEL_LAYOUT_HRGB = 1,
            
            /** Horizontal BGR subpixel layout. */
            FONT_LCD_SUBPIXEL_LAYOUT_HBGR = 2,
            
            /** Vertical RGB subpixel layout. */
            FONT_LCD_SUBPIXEL_LAYOUT_VRGB = 3,
            
            /** Vertical BGR subpixel layout. */
            FONT_LCD_SUBPIXEL_LAYOUT_VBGR = 4,
            
            /** Represents the size of the [enum FontLCDSubpixelLayout] enum. */
            FONT_LCD_SUBPIXEL_LAYOUT_MAX = 5,
        }
        enum Direction {
            /** Text direction is determined based on contents and current locale. */
            DIRECTION_AUTO = 0,
            
            /** Text is written from left to right. */
            DIRECTION_LTR = 1,
            
            /** Text is written from right to left. */
            DIRECTION_RTL = 2,
            
            /** Text writing direction is the same as base string writing direction. Used for BiDi override only. */
            DIRECTION_INHERITED = 3,
        }
        enum Orientation {
            /** Text is written horizontally. */
            ORIENTATION_HORIZONTAL = 0,
            
            /** Left to right text is written vertically from top to bottom.  
             *  Right to left text is written vertically from bottom to top.  
             */
            ORIENTATION_VERTICAL = 1,
        }
        enum JustificationFlag {
            /** Do not justify text. */
            JUSTIFICATION_NONE = 0,
            
            /** Justify text by adding and removing kashidas. */
            JUSTIFICATION_KASHIDA = 1,
            
            /** Justify text by changing width of the spaces between the words. */
            JUSTIFICATION_WORD_BOUND = 2,
            
            /** Remove trailing and leading spaces from the justified text. */
            JUSTIFICATION_TRIM_EDGE_SPACES = 4,
            
            /** Only apply justification to the part of the text after the last tab. */
            JUSTIFICATION_AFTER_LAST_TAB = 8,
            
            /** Apply justification to the trimmed line with ellipsis. */
            JUSTIFICATION_CONSTRAIN_ELLIPSIS = 16,
            
            /** Do not apply justification to the last line of the paragraph. */
            JUSTIFICATION_SKIP_LAST_LINE = 32,
            
            /** Do not apply justification to the last line of the paragraph with visible characters (takes precedence over [constant JUSTIFICATION_SKIP_LAST_LINE]). */
            JUSTIFICATION_SKIP_LAST_LINE_WITH_VISIBLE_CHARS = 64,
            
            /** Always apply justification to the paragraphs with a single line ([constant JUSTIFICATION_SKIP_LAST_LINE] and [constant JUSTIFICATION_SKIP_LAST_LINE_WITH_VISIBLE_CHARS] are ignored). */
            JUSTIFICATION_DO_NOT_SKIP_SINGLE_LINE = 128,
        }
        enum AutowrapMode {
            /** Autowrap is disabled. */
            AUTOWRAP_OFF = 0,
            
            /** Wraps the text inside the node's bounding rectangle by allowing to break lines at arbitrary positions, which is useful when very limited space is available. */
            AUTOWRAP_ARBITRARY = 1,
            
            /** Wraps the text inside the node's bounding rectangle by soft-breaking between words. */
            AUTOWRAP_WORD = 2,
            
            /** Behaves similarly to [constant AUTOWRAP_WORD], but force-breaks a word if that single word does not fit in one line. */
            AUTOWRAP_WORD_SMART = 3,
        }
        enum LineBreakFlag {
            /** Do not break the line. */
            BREAK_NONE = 0,
            
            /** Break the line at the line mandatory break characters (e.g. `"\n"`). */
            BREAK_MANDATORY = 1,
            
            /** Break the line between the words. */
            BREAK_WORD_BOUND = 2,
            
            /** Break the line between any unconnected graphemes. */
            BREAK_GRAPHEME_BOUND = 4,
            
            /** Should be used only in conjunction with [constant BREAK_WORD_BOUND], break the line between any unconnected graphemes, if it's impossible to break it between the words. */
            BREAK_ADAPTIVE = 8,
            
            /** Remove edge spaces from the broken line segments. */
            BREAK_TRIM_EDGE_SPACES = 16,
            
            /** Subtract first line indentation width from all lines after the first one. */
            BREAK_TRIM_INDENT = 32,
            
            /** Remove spaces and line break characters from the start of broken line segments.  
             *  E.g, after line breaking, the second segment of the following text `test  \n  next`, is `next` if the flag is set, and `  next` if it is not.  
             */
            BREAK_TRIM_START_EDGE_SPACES = 64,
            
            /** Remove spaces and line break characters from the end of broken line segments.  
             *  E.g, after line breaking, the first segment of the following text `test  \n  next`, is `test` if the flag is set, and `test  \n` if it is not.  
             */
            BREAK_TRIM_END_EDGE_SPACES = 128,
        }
        enum VisibleCharactersBehavior {
            /** Trims text before the shaping. e.g, increasing [member Label.visible_characters] or [member RichTextLabel.visible_characters] value is visually identical to typing the text.  
             *      
             *  **Note:** In this mode, trimmed text is not processed at all. It is not accounted for in line breaking and size calculations.  
             */
            VC_CHARS_BEFORE_SHAPING = 0,
            
            /** Displays glyphs that are mapped to the first [member Label.visible_characters] or [member RichTextLabel.visible_characters] characters from the beginning of the text. */
            VC_CHARS_AFTER_SHAPING = 1,
            
            /** Displays [member Label.visible_ratio] or [member RichTextLabel.visible_ratio] glyphs, starting from the left or from the right, depending on [member Control.layout_direction] value. */
            VC_GLYPHS_AUTO = 2,
            
            /** Displays [member Label.visible_ratio] or [member RichTextLabel.visible_ratio] glyphs, starting from the left. */
            VC_GLYPHS_LTR = 3,
            
            /** Displays [member Label.visible_ratio] or [member RichTextLabel.visible_ratio] glyphs, starting from the right. */
            VC_GLYPHS_RTL = 4,
        }
        enum OverrunBehavior {
            /** No text trimming is performed. */
            OVERRUN_NO_TRIMMING = 0,
            
            /** Trims the text per character. */
            OVERRUN_TRIM_CHAR = 1,
            
            /** Trims the text per word. */
            OVERRUN_TRIM_WORD = 2,
            
            /** Trims the text per character and adds an ellipsis to indicate that parts are hidden if trimmed text is 6 characters or longer. */
            OVERRUN_TRIM_ELLIPSIS = 3,
            
            /** Trims the text per word and adds an ellipsis to indicate that parts are hidden if trimmed text is 6 characters or longer. */
            OVERRUN_TRIM_WORD_ELLIPSIS = 4,
            
            /** Trims the text per character and adds an ellipsis to indicate that parts are hidden regardless of trimmed text length. */
            OVERRUN_TRIM_ELLIPSIS_FORCE = 5,
            
            /** Trims the text per word and adds an ellipsis to indicate that parts are hidden regardless of trimmed text length. */
            OVERRUN_TRIM_WORD_ELLIPSIS_FORCE = 6,
        }
        enum TextOverrunFlag {
            /** No trimming is performed. */
            OVERRUN_NO_TRIM = 0,
            
            /** Trims the text when it exceeds the given width. */
            OVERRUN_TRIM = 1,
            
            /** Trims the text per word instead of per grapheme. */
            OVERRUN_TRIM_WORD_ONLY = 2,
            
            /** Determines whether an ellipsis should be added at the end of the text. */
            OVERRUN_ADD_ELLIPSIS = 4,
            
            /** Determines whether the ellipsis at the end of the text is enforced and may not be hidden. */
            OVERRUN_ENFORCE_ELLIPSIS = 8,
            
            /** Accounts for the text being justified before attempting to trim it (see [enum JustificationFlag]). */
            OVERRUN_JUSTIFICATION_AWARE = 16,
            
            /** Determines whether the ellipsis should be added regardless of the string length, otherwise it is added only if the string is 6 characters or longer. */
            OVERRUN_SHORT_STRING_ELLIPSIS = 32,
        }
        enum GraphemeFlag {
            /** Grapheme is supported by the font, and can be drawn. */
            GRAPHEME_IS_VALID = 1,
            
            /** Grapheme is part of right-to-left or bottom-to-top run. */
            GRAPHEME_IS_RTL = 2,
            
            /** Grapheme is not part of source text, it was added by justification process. */
            GRAPHEME_IS_VIRTUAL = 4,
            
            /** Grapheme is whitespace. */
            GRAPHEME_IS_SPACE = 8,
            
            /** Grapheme is mandatory break point (e.g. `"\n"`). */
            GRAPHEME_IS_BREAK_HARD = 16,
            
            /** Grapheme is optional break point (e.g. space). */
            GRAPHEME_IS_BREAK_SOFT = 32,
            
            /** Grapheme is the tabulation character. */
            GRAPHEME_IS_TAB = 64,
            
            /** Grapheme is kashida. */
            GRAPHEME_IS_ELONGATION = 128,
            
            /** Grapheme is punctuation character. */
            GRAPHEME_IS_PUNCTUATION = 256,
            
            /** Grapheme is underscore character. */
            GRAPHEME_IS_UNDERSCORE = 512,
            
            /** Grapheme is connected to the previous grapheme. Breaking line before this grapheme is not safe. */
            GRAPHEME_IS_CONNECTED = 1024,
            
            /** It is safe to insert a U+0640 before this grapheme for elongation. */
            GRAPHEME_IS_SAFE_TO_INSERT_TATWEEL = 2048,
            
            /** Grapheme is an object replacement character for the embedded object. */
            GRAPHEME_IS_EMBEDDED_OBJECT = 4096,
            
            /** Grapheme is a soft hyphen. */
            GRAPHEME_IS_SOFT_HYPHEN = 8192,
        }
        enum Hinting {
            /** Disables font hinting (smoother but less crisp). */
            HINTING_NONE = 0,
            
            /** Use the light font hinting mode. */
            HINTING_LIGHT = 1,
            
            /** Use the default font hinting mode (crisper but less smooth).  
             *      
             *  **Note:** This hinting mode changes both horizontal and vertical glyph metrics. If applied to monospace font, some glyphs might have different width.  
             */
            HINTING_NORMAL = 2,
        }
        enum SubpixelPositioning {
            /** Glyph horizontal position is rounded to the whole pixel size, each glyph is rasterized once. */
            SUBPIXEL_POSITIONING_DISABLED = 0,
            
            /** Glyph horizontal position is rounded based on font size.  
             *  - To one quarter of the pixel size if font size is smaller or equal to [constant SUBPIXEL_POSITIONING_ONE_QUARTER_MAX_SIZE].  
             *  - To one half of the pixel size if font size is smaller or equal to [constant SUBPIXEL_POSITIONING_ONE_HALF_MAX_SIZE].  
             *  - To the whole pixel size for larger fonts.  
             */
            SUBPIXEL_POSITIONING_AUTO = 1,
            
            /** Glyph horizontal position is rounded to one half of the pixel size, each glyph is rasterized up to two times. */
            SUBPIXEL_POSITIONING_ONE_HALF = 2,
            
            /** Glyph horizontal position is rounded to one quarter of the pixel size, each glyph is rasterized up to four times. */
            SUBPIXEL_POSITIONING_ONE_QUARTER = 3,
            
            /** Maximum font size which will use "one half of the pixel" subpixel positioning in [constant SUBPIXEL_POSITIONING_AUTO] mode. */
            SUBPIXEL_POSITIONING_ONE_HALF_MAX_SIZE = 20,
            
            /** Maximum font size which will use "one quarter of the pixel" subpixel positioning in [constant SUBPIXEL_POSITIONING_AUTO] mode. */
            SUBPIXEL_POSITIONING_ONE_QUARTER_MAX_SIZE = 16,
        }
        enum Feature {
            /** TextServer supports simple text layouts. */
            FEATURE_SIMPLE_LAYOUT = 1,
            
            /** TextServer supports bidirectional text layouts. */
            FEATURE_BIDI_LAYOUT = 2,
            
            /** TextServer supports vertical layouts. */
            FEATURE_VERTICAL_LAYOUT = 4,
            
            /** TextServer supports complex text shaping. */
            FEATURE_SHAPING = 8,
            
            /** TextServer supports justification using kashidas. */
            FEATURE_KASHIDA_JUSTIFICATION = 16,
            
            /** TextServer supports complex line/word breaking rules (e.g. dictionary based). */
            FEATURE_BREAK_ITERATORS = 32,
            
            /** TextServer supports loading bitmap fonts. */
            FEATURE_FONT_BITMAP = 64,
            
            /** TextServer supports loading dynamic (TrueType, OpeType, etc.) fonts. */
            FEATURE_FONT_DYNAMIC = 128,
            
            /** TextServer supports multichannel signed distance field dynamic font rendering. */
            FEATURE_FONT_MSDF = 256,
            
            /** TextServer supports loading system fonts. */
            FEATURE_FONT_SYSTEM = 512,
            
            /** TextServer supports variable fonts. */
            FEATURE_FONT_VARIABLE = 1024,
            
            /** TextServer supports locale dependent and context sensitive case conversion. */
            FEATURE_CONTEXT_SENSITIVE_CASE_CONVERSION = 2048,
            
            /** TextServer require external data file for some features, see [method load_support_data]. */
            FEATURE_USE_SUPPORT_DATA = 4096,
            
            /** TextServer supports UAX #31 identifier validation, see [method is_valid_identifier]. */
            FEATURE_UNICODE_IDENTIFIERS = 8192,
            
            /** TextServer supports [url=https://unicode.org/reports/tr36/]Unicode Technical Report #36[/url] and [url=https://unicode.org/reports/tr39/]Unicode Technical Standard #39[/url] based spoof detection features. */
            FEATURE_UNICODE_SECURITY = 16384,
        }
        enum ContourPointTag {
            /** Contour point is on the curve. */
            CONTOUR_CURVE_TAG_ON = 1,
            
            /** Contour point isn't on the curve, but serves as a control point for a conic (quadratic) Bézier arc. */
            CONTOUR_CURVE_TAG_OFF_CONIC = 0,
            
            /** Contour point isn't on the curve, but serves as a control point for a cubic Bézier arc. */
            CONTOUR_CURVE_TAG_OFF_CUBIC = 2,
        }
        enum SpacingType {
            /** Spacing for each glyph. */
            SPACING_GLYPH = 0,
            
            /** Spacing for the space character. */
            SPACING_SPACE = 1,
            
            /** Spacing at the top of the line. */
            SPACING_TOP = 2,
            
            /** Spacing at the bottom of the line. */
            SPACING_BOTTOM = 3,
            
            /** Represents the size of the [enum SpacingType] enum. */
            SPACING_MAX = 4,
        }
        enum FontStyle {
            /** Font is bold. */
            FONT_BOLD = 1,
            
            /** Font is italic or oblique. */
            FONT_ITALIC = 2,
            
            /** Font has fixed-width characters (also known as monospace). */
            FONT_FIXED_WIDTH = 4,
        }
        enum StructuredTextParser {
            /** Use default Unicode BiDi algorithm. */
            STRUCTURED_TEXT_DEFAULT = 0,
            
            /** BiDi override for URI. */
            STRUCTURED_TEXT_URI = 1,
            
            /** BiDi override for file path. */
            STRUCTURED_TEXT_FILE = 2,
            
            /** BiDi override for email. */
            STRUCTURED_TEXT_EMAIL = 3,
            
            /** BiDi override for lists. Structured text options: list separator [String]. */
            STRUCTURED_TEXT_LIST = 4,
            
            /** BiDi override for GDScript. */
            STRUCTURED_TEXT_GDSCRIPT = 5,
            
            /** User defined structured text BiDi override function. */
            STRUCTURED_TEXT_CUSTOM = 6,
        }
        enum FixedSizeScaleMode {
            /** Bitmap font is not scaled. */
            FIXED_SIZE_SCALE_DISABLE = 0,
            
            /** Bitmap font is scaled to the closest integer multiple of the font's fixed size. This is the recommended option for pixel art fonts. */
            FIXED_SIZE_SCALE_INTEGER_ONLY = 1,
            
            /** Bitmap font is scaled to an arbitrary (fractional) size. This is the recommended option for non-pixel art fonts. */
            FIXED_SIZE_SCALE_ENABLED = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextServer extends __NameMapRefCounted {
    }
    /** A server interface for font management and text rendering.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textserver.html  
     */
    class TextServer extends RefCounted {
        constructor(identifier?: any)
        /** Returns `true` if the server supports a feature. */
        has_feature(feature: TextServer.Feature): boolean
        
        /** Returns the name of the server interface. */
        get_name(): string
        
        /** Returns text server features, see [enum Feature]. */
        get_features(): int64
        
        /** Loads optional TextServer database (e.g. ICU break iterators and dictionaries).  
         *      
         *  **Note:** This function should be called before any other TextServer functions used, otherwise it won't have any effect.  
         */
        load_support_data(filename: string): boolean
        
        /** Returns default TextServer database (e.g. ICU break iterators and dictionaries) filename. */
        get_support_data_filename(): string
        
        /** Returns TextServer database (e.g. ICU break iterators and dictionaries) description. */
        get_support_data_info(): string
        
        /** Saves optional TextServer database (e.g. ICU break iterators and dictionaries) to the file.  
         *      
         *  **Note:** This function is used by during project export, to include TextServer database.  
         */
        save_support_data(filename: string): boolean
        
        /** Returns default TextServer database (e.g. ICU break iterators and dictionaries). */
        get_support_data(): PackedByteArray
        
        /** Returns `true` if the locale requires text server support data for line/word breaking. */
        is_locale_using_support_data(locale: string): boolean
        
        /** Returns `true` if locale is right-to-left. */
        is_locale_right_to_left(locale: string): boolean
        
        /** Converts the given readable name of a feature, variation, script, or language to an OpenType tag. */
        name_to_tag(name: string): int64
        
        /** Converts the given OpenType tag to the readable name of a feature, variation, script, or language. */
        tag_to_name(tag: int64): string
        
        /** Returns `true` if [param rid] is valid resource owned by this text server. */
        has(rid: RID): boolean
        
        /** Frees an object created by this [TextServer]. */
        free_rid(rid: RID): void
        
        /** Creates a new, empty font cache entry resource. To free the resulting resource, use the [method free_rid] method. */
        create_font(): RID
        
        /** Creates a new variation existing font which is reusing the same glyph cache and font data. To free the resulting resource, use the [method free_rid] method. */
        create_font_linked_variation(font_rid: RID): RID
        
        /** Sets font source data, e.g contents of the dynamic font source file. */
        font_set_data(font_rid: RID, data: PackedByteArray | byte[] | ArrayBuffer): void
        
        /** Sets an active face index in the TrueType / OpenType collection. */
        font_set_face_index(font_rid: RID, face_index: int64): void
        
        /** Returns an active face index in the TrueType / OpenType collection. */
        font_get_face_index(font_rid: RID): int64
        
        /** Returns number of faces in the TrueType / OpenType collection. */
        font_get_face_count(font_rid: RID): int64
        
        /** Sets the font style flags.  
         *      
         *  **Note:** This value is used for font matching only and will not affect font rendering. Use [method font_set_face_index], [method font_set_variation_coordinates], [method font_set_embolden], or [method font_set_transform] instead.  
         */
        font_set_style(font_rid: RID, style: TextServer.FontStyle): void
        
        /** Returns font style flags. */
        font_get_style(font_rid: RID): TextServer.FontStyle
        
        /** Sets the font family name. */
        font_set_name(font_rid: RID, name: string): void
        
        /** Returns font family name. */
        font_get_name(font_rid: RID): string
        
        /** Returns [Dictionary] with OpenType font name strings (localized font names, version, description, license information, sample text, etc.). */
        font_get_ot_name_strings(font_rid: RID): GDictionary
        
        /** Sets the font style name. */
        font_set_style_name(font_rid: RID, name: string): void
        
        /** Returns font style name. */
        font_get_style_name(font_rid: RID): string
        
        /** Sets weight (boldness) of the font. A value in the `100...999` range, normal font weight is `400`, bold font weight is `700`.  
         *      
         *  **Note:** This value is used for font matching only and will not affect font rendering. Use [method font_set_face_index], [method font_set_variation_coordinates], or [method font_set_embolden] instead.  
         */
        font_set_weight(font_rid: RID, weight: int64): void
        
        /** Returns weight (boldness) of the font. A value in the `100...999` range, normal font weight is `400`, bold font weight is `700`. */
        font_get_weight(font_rid: RID): int64
        
        /** Sets font stretch amount, compared to a normal width. A percentage value between `50%` and `200%`.  
         *      
         *  **Note:** This value is used for font matching only and will not affect font rendering. Use [method font_set_face_index], [method font_set_variation_coordinates], or [method font_set_transform] instead.  
         */
        font_set_stretch(font_rid: RID, weight: int64): void
        
        /** Returns font stretch amount, compared to a normal width. A percentage value between `50%` and `200%`. */
        font_get_stretch(font_rid: RID): int64
        
        /** Sets font anti-aliasing mode. */
        font_set_antialiasing(font_rid: RID, antialiasing: TextServer.FontAntialiasing): void
        
        /** Returns font anti-aliasing mode. */
        font_get_antialiasing(font_rid: RID): TextServer.FontAntialiasing
        
        /** If set to `true`, embedded font bitmap loading is disabled (bitmap-only and color fonts ignore this property). */
        font_set_disable_embedded_bitmaps(font_rid: RID, disable_embedded_bitmaps: boolean): void
        
        /** Returns whether the font's embedded bitmap loading is disabled. */
        font_get_disable_embedded_bitmaps(font_rid: RID): boolean
        
        /** If set to `true` font texture mipmap generation is enabled. */
        font_set_generate_mipmaps(font_rid: RID, generate_mipmaps: boolean): void
        
        /** Returns `true` if font texture mipmap generation is enabled. */
        font_get_generate_mipmaps(font_rid: RID): boolean
        
        /** If set to `true`, glyphs of all sizes are rendered using single multichannel signed distance field generated from the dynamic font vector data. MSDF rendering allows displaying the font at any scaling factor without blurriness, and without incurring a CPU cost when the font size changes (since the font no longer needs to be rasterized on the CPU). As a downside, font hinting is not available with MSDF. The lack of font hinting may result in less crisp and less readable fonts at small sizes.  
         *      
         *  **Note:** MSDF font rendering does not render glyphs with overlapping shapes correctly. Overlapping shapes are not valid per the OpenType standard, but are still commonly found in many font files, especially those converted by Google Fonts. To avoid issues with overlapping glyphs, consider downloading the font file directly from the type foundry instead of relying on Google Fonts.  
         */
        font_set_multichannel_signed_distance_field(font_rid: RID, msdf: boolean): void
        
        /** Returns `true` if glyphs of all sizes are rendered using single multichannel signed distance field generated from the dynamic font vector data. */
        font_is_multichannel_signed_distance_field(font_rid: RID): boolean
        
        /** Sets the width of the range around the shape between the minimum and maximum representable signed distance. */
        font_set_msdf_pixel_range(font_rid: RID, msdf_pixel_range: int64): void
        
        /** Returns the width of the range around the shape between the minimum and maximum representable signed distance. */
        font_get_msdf_pixel_range(font_rid: RID): int64
        
        /** Sets source font size used to generate MSDF textures. */
        font_set_msdf_size(font_rid: RID, msdf_size: int64): void
        
        /** Returns source font size used to generate MSDF textures. */
        font_get_msdf_size(font_rid: RID): int64
        
        /** Sets bitmap font fixed size. If set to value greater than zero, same cache entry will be used for all font sizes. */
        font_set_fixed_size(font_rid: RID, fixed_size: int64): void
        
        /** Returns bitmap font fixed size. */
        font_get_fixed_size(font_rid: RID): int64
        
        /** Sets bitmap font scaling mode. This property is used only if `fixed_size` is greater than zero. */
        font_set_fixed_size_scale_mode(font_rid: RID, fixed_size_scale_mode: TextServer.FixedSizeScaleMode): void
        
        /** Returns bitmap font scaling mode. */
        font_get_fixed_size_scale_mode(font_rid: RID): TextServer.FixedSizeScaleMode
        
        /** If set to `true`, system fonts can be automatically used as fallbacks. */
        font_set_allow_system_fallback(font_rid: RID, allow_system_fallback: boolean): void
        
        /** Returns `true` if system fonts can be automatically used as fallbacks. */
        font_is_allow_system_fallback(font_rid: RID): boolean
        
        /** Frees all automatically loaded system fonts. */
        font_clear_system_fallback_cache(): void
        
        /** If set to `true` auto-hinting is preferred over font built-in hinting. */
        font_set_force_autohinter(font_rid: RID, force_autohinter: boolean): void
        
        /** Returns `true` if auto-hinting is supported and preferred over font built-in hinting. Used by dynamic fonts only. */
        font_is_force_autohinter(font_rid: RID): boolean
        
        /** If set to `true`, color modulation is applied when drawing colored glyphs, otherwise it's applied to the monochrome glyphs only. */
        font_set_modulate_color_glyphs(font_rid: RID, force_autohinter: boolean): void
        
        /** Returns `true` if color modulation is applied when drawing the font's colored glyphs. */
        font_is_modulate_color_glyphs(font_rid: RID): boolean
        
        /** Sets font hinting mode. Used by dynamic fonts only. */
        font_set_hinting(font_rid: RID, hinting: TextServer.Hinting): void
        
        /** Returns the font hinting mode. Used by dynamic fonts only. */
        font_get_hinting(font_rid: RID): TextServer.Hinting
        
        /** Sets font subpixel glyph positioning mode. */
        font_set_subpixel_positioning(font_rid: RID, subpixel_positioning: TextServer.SubpixelPositioning): void
        
        /** Returns font subpixel glyph positioning mode. */
        font_get_subpixel_positioning(font_rid: RID): TextServer.SubpixelPositioning
        
        /** Sets glyph position rounding behavior. If set to `true`, when aligning glyphs to the pixel boundaries rounding remainders are accumulated to ensure more uniform glyph distribution. This setting has no effect if subpixel positioning is enabled. */
        font_set_keep_rounding_remainders(font_rid: RID, keep_rounding_remainders: boolean): void
        
        /** Returns glyph position rounding behavior. If set to `true`, when aligning glyphs to the pixel boundaries rounding remainders are accumulated to ensure more uniform glyph distribution. This setting has no effect if subpixel positioning is enabled. */
        font_get_keep_rounding_remainders(font_rid: RID): boolean
        
        /** Sets font embolden strength. If [param strength] is not equal to zero, emboldens the font outlines. Negative values reduce the outline thickness. */
        font_set_embolden(font_rid: RID, strength: float64): void
        
        /** Returns font embolden strength. */
        font_get_embolden(font_rid: RID): float64
        
        /** Sets the spacing for [param spacing] to [param value] in pixels (not relative to the font size). */
        font_set_spacing(font_rid: RID, spacing: TextServer.SpacingType, value: int64): void
        
        /** Returns the spacing for [param spacing] in pixels (not relative to the font size). */
        font_get_spacing(font_rid: RID, spacing: TextServer.SpacingType): int64
        
        /** Sets extra baseline offset (as a fraction of font height). */
        font_set_baseline_offset(font_rid: RID, baseline_offset: float64): void
        
        /** Returns extra baseline offset (as a fraction of font height). */
        font_get_baseline_offset(font_rid: RID): float64
        
        /** Sets 2D transform, applied to the font outlines, can be used for slanting, flipping, and rotating glyphs.  
         *  For example, to simulate italic typeface by slanting, apply the following transform `Transform2D(1.0, slant, 0.0, 1.0, 0.0, 0.0)`.  
         */
        font_set_transform(font_rid: RID, transform: Transform2D): void
        
        /** Returns 2D transform applied to the font outlines. */
        font_get_transform(font_rid: RID): Transform2D
        
        /** Sets variation coordinates for the specified font cache entry. See [method font_supported_variation_list] for more info. */
        font_set_variation_coordinates(font_rid: RID, variation_coordinates: GDictionary): void
        
        /** Returns variation coordinates for the specified font cache entry. See [method font_supported_variation_list] for more info. */
        font_get_variation_coordinates(font_rid: RID): GDictionary
        
        /** If set to a positive value, overrides the oversampling factor of the viewport this font is used in. See [member Viewport.oversampling]. This value doesn't override the [code skip-lint]oversampling` parameter of [code skip-lint]draw_*` methods. Used by dynamic fonts only. */
        font_set_oversampling(font_rid: RID, oversampling: float64): void
        
        /** Returns oversampling factor override. If set to a positive value, overrides the oversampling factor of the viewport this font is used in. See [member Viewport.oversampling]. This value doesn't override the [code skip-lint]oversampling` parameter of [code skip-lint]draw_*` methods. Used by dynamic fonts only. */
        font_get_oversampling(font_rid: RID): float64
        
        /** Returns list of the font sizes in the cache. Each size is [Vector2i] with font size and outline size. */
        font_get_size_cache_list(font_rid: RID): GArray<Vector2i>
        
        /** Removes all font sizes from the cache entry. */
        font_clear_size_cache(font_rid: RID): void
        
        /** Removes specified font size from the cache entry. */
        font_remove_size_cache(font_rid: RID, size: Vector2i): void
        
        /** Returns font cache information, each entry contains the following fields: `Vector2i size_px` - font size in pixels, `float viewport_oversampling` - viewport oversampling factor, `int glyphs` - number of rendered glyphs, `int textures` - number of used textures, `int textures_size` - size of texture data in bytes. */
        font_get_size_cache_info(font_rid: RID): GArray<GDictionary>
        
        /** Sets the font ascent (number of pixels above the baseline). */
        font_set_ascent(font_rid: RID, size: int64, ascent: float64): void
        
        /** Returns the font ascent (number of pixels above the baseline). */
        font_get_ascent(font_rid: RID, size: int64): float64
        
        /** Sets the font descent (number of pixels below the baseline). */
        font_set_descent(font_rid: RID, size: int64, descent: float64): void
        
        /** Returns the font descent (number of pixels below the baseline). */
        font_get_descent(font_rid: RID, size: int64): float64
        
        /** Sets pixel offset of the underline below the baseline. */
        font_set_underline_position(font_rid: RID, size: int64, underline_position: float64): void
        
        /** Returns pixel offset of the underline below the baseline. */
        font_get_underline_position(font_rid: RID, size: int64): float64
        
        /** Sets thickness of the underline in pixels. */
        font_set_underline_thickness(font_rid: RID, size: int64, underline_thickness: float64): void
        
        /** Returns thickness of the underline in pixels. */
        font_get_underline_thickness(font_rid: RID, size: int64): float64
        
        /** Sets scaling factor of the color bitmap font. */
        font_set_scale(font_rid: RID, size: int64, scale: float64): void
        
        /** Returns scaling factor of the color bitmap font. */
        font_get_scale(font_rid: RID, size: int64): float64
        
        /** Returns number of textures used by font cache entry. */
        font_get_texture_count(font_rid: RID, size: Vector2i): int64
        
        /** Removes all textures from font cache entry.  
         *      
         *  **Note:** This function will not remove glyphs associated with the texture, use [method font_remove_glyph] to remove them manually.  
         */
        font_clear_textures(font_rid: RID, size: Vector2i): void
        
        /** Removes specified texture from the cache entry.  
         *      
         *  **Note:** This function will not remove glyphs associated with the texture, remove them manually, using [method font_remove_glyph].  
         */
        font_remove_texture(font_rid: RID, size: Vector2i, texture_index: int64): void
        
        /** Sets font cache texture image data. */
        font_set_texture_image(font_rid: RID, size: Vector2i, texture_index: int64, image: Image): void
        
        /** Returns font cache texture image data. */
        font_get_texture_image(font_rid: RID, size: Vector2i, texture_index: int64): null | Image
        
        /** Sets array containing glyph packing data. */
        font_set_texture_offsets(font_rid: RID, size: Vector2i, texture_index: int64, offset: PackedInt32Array | int32[]): void
        
        /** Returns array containing glyph packing data. */
        font_get_texture_offsets(font_rid: RID, size: Vector2i, texture_index: int64): PackedInt32Array
        
        /** Returns list of rendered glyphs in the cache entry. */
        font_get_glyph_list(font_rid: RID, size: Vector2i): PackedInt32Array
        
        /** Removes all rendered glyph information from the cache entry.  
         *      
         *  **Note:** This function will not remove textures associated with the glyphs, use [method font_remove_texture] to remove them manually.  
         */
        font_clear_glyphs(font_rid: RID, size: Vector2i): void
        
        /** Removes specified rendered glyph information from the cache entry.  
         *      
         *  **Note:** This function will not remove textures associated with the glyphs, use [method font_remove_texture] to remove them manually.  
         */
        font_remove_glyph(font_rid: RID, size: Vector2i, glyph: int64): void
        
        /** Returns glyph advance (offset of the next glyph).  
         *      
         *  **Note:** Advance for glyphs outlines is the same as the base glyph advance and is not saved.  
         */
        font_get_glyph_advance(font_rid: RID, size: int64, glyph: int64): Vector2
        
        /** Sets glyph advance (offset of the next glyph).  
         *      
         *  **Note:** Advance for glyphs outlines is the same as the base glyph advance and is not saved.  
         */
        font_set_glyph_advance(font_rid: RID, size: int64, glyph: int64, advance: Vector2): void
        
        /** Returns glyph offset from the baseline. */
        font_get_glyph_offset(font_rid: RID, size: Vector2i, glyph: int64): Vector2
        
        /** Sets glyph offset from the baseline. */
        font_set_glyph_offset(font_rid: RID, size: Vector2i, glyph: int64, offset: Vector2): void
        
        /** Returns size of the glyph. */
        font_get_glyph_size(font_rid: RID, size: Vector2i, glyph: int64): Vector2
        
        /** Sets size of the glyph. */
        font_set_glyph_size(font_rid: RID, size: Vector2i, glyph: int64, gl_size: Vector2): void
        
        /** Returns rectangle in the cache texture containing the glyph. */
        font_get_glyph_uv_rect(font_rid: RID, size: Vector2i, glyph: int64): Rect2
        
        /** Sets rectangle in the cache texture containing the glyph. */
        font_set_glyph_uv_rect(font_rid: RID, size: Vector2i, glyph: int64, uv_rect: Rect2): void
        
        /** Returns index of the cache texture containing the glyph. */
        font_get_glyph_texture_idx(font_rid: RID, size: Vector2i, glyph: int64): int64
        
        /** Sets index of the cache texture containing the glyph. */
        font_set_glyph_texture_idx(font_rid: RID, size: Vector2i, glyph: int64, texture_idx: int64): void
        
        /** Returns resource ID of the cache texture containing the glyph.  
         *      
         *  **Note:** If there are pending glyphs to render, calling this function might trigger the texture cache update.  
         */
        font_get_glyph_texture_rid(font_rid: RID, size: Vector2i, glyph: int64): RID
        
        /** Returns size of the cache texture containing the glyph.  
         *      
         *  **Note:** If there are pending glyphs to render, calling this function might trigger the texture cache update.  
         */
        font_get_glyph_texture_size(font_rid: RID, size: Vector2i, glyph: int64): Vector2
        
        /** Returns outline contours of the glyph as a [Dictionary] with the following contents:  
         *  `points`         - [PackedVector3Array], containing outline points. `x` and `y` are point coordinates. `z` is the type of the point, using the [enum ContourPointTag] values.  
         *  `contours`       - [PackedInt32Array], containing indices the end points of each contour.  
         *  `orientation`    - [bool], contour orientation. If `true`, clockwise contours must be filled.  
         *  - Two successive [constant CONTOUR_CURVE_TAG_ON] points indicate a line segment.  
         *  - One [constant CONTOUR_CURVE_TAG_OFF_CONIC] point between two [constant CONTOUR_CURVE_TAG_ON] points indicates a single conic (quadratic) Bézier arc.  
         *  - Two [constant CONTOUR_CURVE_TAG_OFF_CUBIC] points between two [constant CONTOUR_CURVE_TAG_ON] points indicate a single cubic Bézier arc.  
         *  - Two successive [constant CONTOUR_CURVE_TAG_OFF_CONIC] points indicate two successive conic (quadratic) Bézier arcs with a virtual [constant CONTOUR_CURVE_TAG_ON] point at their middle.  
         *  - Each contour is closed. The last point of a contour uses the first point of a contour as its next point, and vice versa. The first point can be [constant CONTOUR_CURVE_TAG_OFF_CONIC] point.  
         */
        font_get_glyph_contours(font: RID, size: int64, index: int64): GDictionary
        
        /** Returns list of the kerning overrides. */
        font_get_kerning_list(font_rid: RID, size: int64): GArray<Vector2i>
        
        /** Removes all kerning overrides. */
        font_clear_kerning_map(font_rid: RID, size: int64): void
        
        /** Removes kerning override for the pair of glyphs. */
        font_remove_kerning(font_rid: RID, size: int64, glyph_pair: Vector2i): void
        
        /** Sets kerning for the pair of glyphs. */
        font_set_kerning(font_rid: RID, size: int64, glyph_pair: Vector2i, kerning: Vector2): void
        
        /** Returns kerning for the pair of glyphs. */
        font_get_kerning(font_rid: RID, size: int64, glyph_pair: Vector2i): Vector2
        
        /** Returns the glyph index of a [param char], optionally modified by the [param variation_selector]. See [method font_get_char_from_glyph_index]. */
        font_get_glyph_index(font_rid: RID, size: int64, char: int64, variation_selector: int64): int64
        
        /** Returns character code associated with [param glyph_index], or `0` if [param glyph_index] is invalid. See [method font_get_glyph_index]. */
        font_get_char_from_glyph_index(font_rid: RID, size: int64, glyph_index: int64): int64
        
        /** Returns `true` if a Unicode [param char] is available in the font. */
        font_has_char(font_rid: RID, char: int64): boolean
        
        /** Returns a string containing all the characters available in the font. */
        font_get_supported_chars(font_rid: RID): string
        
        /** Returns an array containing all glyph indices in the font. */
        font_get_supported_glyphs(font_rid: RID): PackedInt32Array
        
        /** Renders the range of characters to the font cache texture. */
        font_render_range(font_rid: RID, size: Vector2i, start: int64, end: int64): void
        
        /** Renders specified glyph to the font cache texture. */
        font_render_glyph(font_rid: RID, size: Vector2i, index: int64): void
        
        /** Draws single glyph into a canvas item at the position, using [param font_rid] at the size [param size]. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used.  
         *      
         *  **Note:** Glyph index is specific to the font, use glyphs indices returned by [method shaped_text_get_glyphs] or [method font_get_glyph_index].  
         *      
         *  **Note:** If there are pending glyphs to render, calling this function might trigger the texture cache update.  
         */
        font_draw_glyph(font_rid: RID, canvas: RID, size: int64, pos: Vector2, index: int64, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draws single glyph outline of size [param outline_size] into a canvas item at the position, using [param font_rid] at the size [param size]. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used.  
         *      
         *  **Note:** Glyph index is specific to the font, use glyphs indices returned by [method shaped_text_get_glyphs] or [method font_get_glyph_index].  
         *      
         *  **Note:** If there are pending glyphs to render, calling this function might trigger the texture cache update.  
         */
        font_draw_glyph_outline(font_rid: RID, canvas: RID, size: int64, outline_size: int64, pos: Vector2, index: int64, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Returns `true` if the font supports the given language (as a [url=https://en.wikipedia.org/wiki/ISO_639-1]ISO 639[/url] code). */
        font_is_language_supported(font_rid: RID, language: string): boolean
        
        /** Adds override for [method font_is_language_supported]. */
        font_set_language_support_override(font_rid: RID, language: string, supported: boolean): void
        
        /** Returns `true` if support override is enabled for the [param language]. */
        font_get_language_support_override(font_rid: RID, language: string): boolean
        
        /** Remove language support override. */
        font_remove_language_support_override(font_rid: RID, language: string): void
        
        /** Returns list of language support overrides. */
        font_get_language_support_overrides(font_rid: RID): PackedStringArray
        
        /** Returns `true` if the font supports the given script (as a [url=https://en.wikipedia.org/wiki/ISO_15924]ISO 15924[/url] code). */
        font_is_script_supported(font_rid: RID, script: string): boolean
        
        /** Adds override for [method font_is_script_supported]. */
        font_set_script_support_override(font_rid: RID, script: string, supported: boolean): void
        
        /** Returns `true` if support override is enabled for the [param script]. */
        font_get_script_support_override(font_rid: RID, script: string): boolean
        
        /** Removes script support override. */
        font_remove_script_support_override(font_rid: RID, script: string): void
        
        /** Returns list of script support overrides. */
        font_get_script_support_overrides(font_rid: RID): PackedStringArray
        
        /** Sets font OpenType feature set override. */
        font_set_opentype_feature_overrides(font_rid: RID, overrides: GDictionary): void
        
        /** Returns font OpenType feature set override. */
        font_get_opentype_feature_overrides(font_rid: RID): GDictionary
        
        /** Returns the dictionary of the supported OpenType features. */
        font_supported_feature_list(font_rid: RID): GDictionary
        
        /** Returns the dictionary of the supported OpenType variation coordinates. */
        font_supported_variation_list(font_rid: RID): GDictionary
        
        /** This method does nothing and always returns `1.0`. */
        font_get_global_oversampling(): float64
        
        /** This method does nothing. */
        font_set_global_oversampling(oversampling: float64): void
        
        /** Returns size of the replacement character (box with character hexadecimal code that is drawn in place of invalid characters). */
        get_hex_code_box_size(size: int64, index: int64): Vector2
        
        /** Draws box displaying character hexadecimal code. Used for replacing missing characters. */
        draw_hex_code_box(canvas: RID, size: int64, pos: Vector2, index: int64, color: Color): void
        
        /** Creates a new buffer for complex text layout, with the given [param direction] and [param orientation]. To free the resulting buffer, use [method free_rid] method.  
         *      
         *  **Note:** Direction is ignored if server does not support [constant FEATURE_BIDI_LAYOUT] feature (supported by [TextServerAdvanced]).  
         *      
         *  **Note:** Orientation is ignored if server does not support [constant FEATURE_VERTICAL_LAYOUT] feature (supported by [TextServerAdvanced]).  
         */
        create_shaped_text(direction?: TextServer.Direction /* = 0 */, orientation?: TextServer.Orientation /* = 0 */): RID
        
        /** Clears text buffer (removes text and inline objects). */
        shaped_text_clear(rid: RID): void
        
        /** Duplicates shaped text buffer. */
        shaped_text_duplicate(rid: RID): RID
        
        /** Sets desired text direction. If set to [constant DIRECTION_AUTO], direction will be detected based on the buffer contents and current locale.  
         *      
         *  **Note:** Direction is ignored if server does not support [constant FEATURE_BIDI_LAYOUT] feature (supported by [TextServerAdvanced]).  
         */
        shaped_text_set_direction(shaped: RID, direction?: TextServer.Direction /* = 0 */): void
        
        /** Returns direction of the text. */
        shaped_text_get_direction(shaped: RID): TextServer.Direction
        
        /** Returns direction of the text, inferred by the BiDi algorithm. */
        shaped_text_get_inferred_direction(shaped: RID): TextServer.Direction
        
        /** Overrides BiDi for the structured text.  
         *  Override ranges should cover full source text without overlaps. BiDi algorithm will be used on each range separately.  
         */
        shaped_text_set_bidi_override(shaped: RID, override: GArray): void
        
        /** Sets custom punctuation character list, used for word breaking. If set to empty string, server defaults are used. */
        shaped_text_set_custom_punctuation(shaped: RID, punct: string): void
        
        /** Returns custom punctuation character list, used for word breaking. If set to empty string, server defaults are used. */
        shaped_text_get_custom_punctuation(shaped: RID): string
        
        /** Sets ellipsis character used for text clipping. */
        shaped_text_set_custom_ellipsis(shaped: RID, char: int64): void
        
        /** Returns ellipsis character used for text clipping. */
        shaped_text_get_custom_ellipsis(shaped: RID): int64
        
        /** Sets desired text orientation.  
         *      
         *  **Note:** Orientation is ignored if server does not support [constant FEATURE_VERTICAL_LAYOUT] feature (supported by [TextServerAdvanced]).  
         */
        shaped_text_set_orientation(shaped: RID, orientation?: TextServer.Orientation /* = 0 */): void
        
        /** Returns text orientation. */
        shaped_text_get_orientation(shaped: RID): TextServer.Orientation
        
        /** If set to `true` text buffer will display invalid characters as hexadecimal codes, otherwise nothing is displayed. */
        shaped_text_set_preserve_invalid(shaped: RID, enabled: boolean): void
        
        /** Returns `true` if text buffer is configured to display hexadecimal codes in place of invalid characters.  
         *      
         *  **Note:** If set to `false`, nothing is displayed in place of invalid characters.  
         */
        shaped_text_get_preserve_invalid(shaped: RID): boolean
        
        /** If set to `true` text buffer will display control characters. */
        shaped_text_set_preserve_control(shaped: RID, enabled: boolean): void
        
        /** Returns `true` if text buffer is configured to display control characters. */
        shaped_text_get_preserve_control(shaped: RID): boolean
        
        /** Sets extra spacing added between glyphs or lines in pixels. */
        shaped_text_set_spacing(shaped: RID, spacing: TextServer.SpacingType, value: int64): void
        
        /** Returns extra spacing added between glyphs or lines in pixels. */
        shaped_text_get_spacing(shaped: RID, spacing: TextServer.SpacingType): int64
        
        /** Adds text span and font to draw it to the text buffer. */
        shaped_text_add_string(shaped: RID, text: string, fonts: GArray<RID>, size: int64, opentype_features?: GDictionary /* = new GDictionary() */, language?: string /* = '' */, meta?: any /* = {} */): boolean
        
        /** Adds inline object to the text buffer, [param key] must be unique. In the text, object is represented as [param length] object replacement characters. */
        shaped_text_add_object(shaped: RID, key: any, size: Vector2, inline_align?: InlineAlignment /* = 5 */, length?: int64 /* = 1 */, baseline?: float64 /* = 0 */): boolean
        
        /** Sets new size and alignment of embedded object. */
        shaped_text_resize_object(shaped: RID, key: any, size: Vector2, inline_align?: InlineAlignment /* = 5 */, baseline?: float64 /* = 0 */): boolean
        
        /** Returns `true` if an object with [param key] is embedded in this shaped text buffer. */
        shaped_text_has_object(shaped: RID, key: any): boolean
        
        /** Returns the text buffer source text, including object replacement characters. */
        shaped_get_text(shaped: RID): string
        
        /** Returns number of text spans added using [method shaped_text_add_string] or [method shaped_text_add_object]. */
        shaped_get_span_count(shaped: RID): int64
        
        /** Returns text span metadata. */
        shaped_get_span_meta(shaped: RID, index: int64): any
        
        /** Returns text embedded object key. */
        shaped_get_span_embedded_object(shaped: RID, index: int64): any
        
        /** Returns the text span source text. */
        shaped_get_span_text(shaped: RID, index: int64): string
        
        /** Returns the text span embedded object key. */
        shaped_get_span_object(shaped: RID, index: int64): any
        
        /** Changes text span font, font size, and OpenType features, without changing the text. */
        shaped_set_span_update_font(shaped: RID, index: int64, fonts: GArray<RID>, size: int64, opentype_features?: GDictionary /* = new GDictionary() */): void
        
        /** Returns the number of uniform text runs in the buffer. */
        shaped_get_run_count(shaped: RID): int64
        
        /** Returns the source text of the [param index] text run (in visual order). */
        shaped_get_run_text(shaped: RID, index: int64): string
        
        /** Returns the source text range of the [param index] text run (in visual order). */
        shaped_get_run_range(shaped: RID, index: int64): Vector2i
        
        /** Returns the font RID of the [param index] text run (in visual order). */
        shaped_get_run_font_rid(shaped: RID, index: int64): RID
        
        /** Returns the font size of the [param index] text run (in visual order). */
        shaped_get_run_font_size(shaped: RID, index: int64): int64
        
        /** Returns the language of the [param index] text run (in visual order). */
        shaped_get_run_language(shaped: RID, index: int64): string
        
        /** Returns the direction of the [param index] text run (in visual order). */
        shaped_get_run_direction(shaped: RID, index: int64): TextServer.Direction
        
        /** Returns the embedded object of the [param index] text run (in visual order). */
        shaped_get_run_object(shaped: RID, index: int64): any
        
        /** Returns text buffer for the substring of the text in the [param shaped] text buffer (including inline objects). */
        shaped_text_substr(shaped: RID, start: int64, length: int64): RID
        
        /** Returns the parent buffer from which the substring originates. */
        shaped_text_get_parent(shaped: RID): RID
        
        /** Adjusts text width to fit to specified width, returns new text width. */
        shaped_text_fit_to_width(shaped: RID, width: float64, justification_flags?: TextServer.JustificationFlag /* = 3 */): float64
        
        /** Aligns shaped text to the given tab-stops. */
        shaped_text_tab_align(shaped: RID, tab_stops: PackedFloat32Array | float32[]): float64
        
        /** Shapes buffer if it's not shaped. Returns `true` if the string is shaped successfully.  
         *      
         *  **Note:** It is not necessary to call this function manually, buffer will be shaped automatically as soon as any of its output data is requested.  
         */
        shaped_text_shape(shaped: RID): boolean
        
        /** Returns `true` if buffer is successfully shaped. */
        shaped_text_is_ready(shaped: RID): boolean
        
        /** Returns `true` if text buffer contains any visible characters. */
        shaped_text_has_visible_chars(shaped: RID): boolean
        
        /** Returns an array of glyphs in the visual order. */
        shaped_text_get_glyphs(shaped: RID): GArray<GDictionary>
        
        /** Returns text glyphs in the logical order. */
        shaped_text_sort_logical(shaped: RID): GArray<GDictionary>
        
        /** Returns number of glyphs in the buffer. */
        shaped_text_get_glyph_count(shaped: RID): int64
        
        /** Returns substring buffer character range in the parent buffer. */
        shaped_text_get_range(shaped: RID): Vector2i
        
        /** Breaks text to the lines and columns. Returns character ranges for each segment. */
        shaped_text_get_line_breaks_adv(shaped: RID, width: PackedFloat32Array | float32[], start?: int64 /* = 0 */, once?: boolean /* = true */, break_flags?: TextServer.LineBreakFlag /* = 3 */): PackedInt32Array
        
        /** Breaks text to the lines and returns character ranges for each line. */
        shaped_text_get_line_breaks(shaped: RID, width: float64, start?: int64 /* = 0 */, break_flags?: TextServer.LineBreakFlag /* = 3 */): PackedInt32Array
        
        /** Breaks text into words and returns array of character ranges. Use [param grapheme_flags] to set what characters are used for breaking. */
        shaped_text_get_word_breaks(shaped: RID, grapheme_flags?: TextServer.GraphemeFlag /* = 264 */, skip_grapheme_flags?: TextServer.GraphemeFlag /* = 4 */): PackedInt32Array
        
        /** Returns the position of the overrun trim. */
        shaped_text_get_trim_pos(shaped: RID): int64
        
        /** Returns position of the ellipsis. */
        shaped_text_get_ellipsis_pos(shaped: RID): int64
        
        /** Returns array of the glyphs in the ellipsis. */
        shaped_text_get_ellipsis_glyphs(shaped: RID): GArray<GDictionary>
        
        /** Returns number of glyphs in the ellipsis. */
        shaped_text_get_ellipsis_glyph_count(shaped: RID): int64
        
        /** Trims text if it exceeds the given width. */
        shaped_text_overrun_trim_to_width(shaped: RID, width?: float64 /* = 0 */, overrun_trim_flags?: TextServer.TextOverrunFlag /* = 0 */): void
        
        /** Returns array of inline objects. */
        shaped_text_get_objects(shaped: RID): GArray
        
        /** Returns bounding rectangle of the inline object. */
        shaped_text_get_object_rect(shaped: RID, key: any): Rect2
        
        /** Returns the character range of the inline object. */
        shaped_text_get_object_range(shaped: RID, key: any): Vector2i
        
        /** Returns the glyph index of the inline object. */
        shaped_text_get_object_glyph(shaped: RID, key: any): int64
        
        /** Returns size of the text. */
        shaped_text_get_size(shaped: RID): Vector2
        
        /** Returns the text ascent (number of pixels above the baseline for horizontal layout or to the left of baseline for vertical).  
         *      
         *  **Note:** Overall ascent can be higher than font ascent, if some glyphs are displaced from the baseline.  
         */
        shaped_text_get_ascent(shaped: RID): float64
        
        /** Returns the text descent (number of pixels below the baseline for horizontal layout or to the right of baseline for vertical).  
         *      
         *  **Note:** Overall descent can be higher than font descent, if some glyphs are displaced from the baseline.  
         */
        shaped_text_get_descent(shaped: RID): float64
        
        /** Returns width (for horizontal layout) or height (for vertical) of the text. */
        shaped_text_get_width(shaped: RID): float64
        
        /** Returns pixel offset of the underline below the baseline. */
        shaped_text_get_underline_position(shaped: RID): float64
        
        /** Returns thickness of the underline. */
        shaped_text_get_underline_thickness(shaped: RID): float64
        
        /** Returns shapes of the carets corresponding to the character offset [param position] in the text. Returned caret shape is 1 pixel wide rectangle. */
        shaped_text_get_carets(shaped: RID, position: int64): GDictionary
        
        /** Returns selection rectangles for the specified character range. */
        shaped_text_get_selection(shaped: RID, start: int64, end: int64): PackedVector2Array
        
        /** Returns grapheme index at the specified pixel offset at the baseline, or `-1` if none is found. */
        shaped_text_hit_test_grapheme(shaped: RID, coords: float64): int64
        
        /** Returns caret character offset at the specified pixel offset at the baseline. This function always returns a valid position. */
        shaped_text_hit_test_position(shaped: RID, coords: float64): int64
        
        /** Returns composite character's bounds as offsets from the start of the line. */
        shaped_text_get_grapheme_bounds(shaped: RID, pos: int64): Vector2
        
        /** Returns grapheme end position closest to the [param pos]. */
        shaped_text_next_grapheme_pos(shaped: RID, pos: int64): int64
        
        /** Returns grapheme start position closest to the [param pos]. */
        shaped_text_prev_grapheme_pos(shaped: RID, pos: int64): int64
        
        /** Returns array of the composite character boundaries. */
        shaped_text_get_character_breaks(shaped: RID): PackedInt32Array
        
        /** Returns composite character end position closest to the [param pos]. */
        shaped_text_next_character_pos(shaped: RID, pos: int64): int64
        
        /** Returns composite character start position closest to the [param pos]. */
        shaped_text_prev_character_pos(shaped: RID, pos: int64): int64
        
        /** Returns composite character position closest to the [param pos]. */
        shaped_text_closest_character_pos(shaped: RID, pos: int64): int64
        
        /** Draw shaped text into a canvas item at a given position, with [param color]. [param pos] specifies the leftmost point of the baseline (for horizontal layout) or topmost point of the baseline (for vertical layout). If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used.  
         *  [param clip_l] and [param clip_r] are offsets relative to [param pos], going to the right in horizontal layout and downward in vertical layout. If [param clip_l] is not negative, glyphs starting before the offset are clipped. If [param clip_r] is not negative, glyphs ending after the offset are clipped.  
         */
        shaped_text_draw(shaped: RID, canvas: RID, pos: Vector2, clip_l?: float64 /* = -1 */, clip_r?: float64 /* = -1 */, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Draw the outline of the shaped text into a canvas item at a given position, with [param color]. [param pos] specifies the leftmost point of the baseline (for horizontal layout) or topmost point of the baseline (for vertical layout). If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used.  
         *  [param clip_l] and [param clip_r] are offsets relative to [param pos], going to the right in horizontal layout and downward in vertical layout. If [param clip_l] is not negative, glyphs starting before the offset are clipped. If [param clip_r] is not negative, glyphs ending after the offset are clipped.  
         */
        shaped_text_draw_outline(shaped: RID, canvas: RID, pos: Vector2, clip_l?: float64 /* = -1 */, clip_r?: float64 /* = -1 */, outline_size?: int64 /* = 1 */, color?: Color /* = new Color(1, 1, 1, 1) */, oversampling?: float64 /* = 0 */): void
        
        /** Returns dominant direction of in the range of text. */
        shaped_text_get_dominant_direction_in_range(shaped: RID, start: int64, end: int64): TextServer.Direction
        
        /** Converts a number from Western Arabic (0..9) to the numeral system used in the given [param language].  
         *  If [param language] is an empty string, the active locale will be used.  
         */
        format_number(number: string, language?: string /* = '' */): string
        
        /** Converts [param number] from the numeral system used in the given [param language] to Western Arabic (0..9).  
         *  If [param language] is an empty string, the active locale will be used.  
         */
        parse_number(number: string, language?: string /* = '' */): string
        
        /** Returns the percent sign used in the given [param language].  
         *  If [param language] is an empty string, the active locale will be used.  
         */
        percent_sign(language?: string /* = '' */): string
        
        /** Returns an array of the word break boundaries. Elements in the returned array are the offsets of the start and end of words. Therefore the length of the array is always even.  
         *  When [param chars_per_line] is greater than zero, line break boundaries are returned instead.  
         *    
         */
        string_get_word_breaks(string_: string, language?: string /* = '' */, chars_per_line?: int64 /* = 0 */): PackedInt32Array
        
        /** Returns array of the composite character boundaries.  
         *    
         */
        string_get_character_breaks(string_: string, language?: string /* = '' */): PackedInt32Array
        
        /** Returns index of the first string in [param dict] which is visually confusable with the [param string], or `-1` if none is found.  
         *      
         *  **Note:** This method doesn't detect invisible characters, for spoof detection use it in combination with [method spoof_check].  
         *      
         *  **Note:** Always returns `-1` if the server does not support the [constant FEATURE_UNICODE_SECURITY] feature.  
         */
        is_confusable(string_: string, dict: PackedStringArray | string[]): int64
        
        /** Returns `true` if [param string] is likely to be an attempt at confusing the reader.  
         *      
         *  **Note:** Always returns `false` if the server does not support the [constant FEATURE_UNICODE_SECURITY] feature.  
         */
        spoof_check(string_: string): boolean
        
        /** Strips diacritics from the string.  
         *      
         *  **Note:** The result may be longer or shorter than the original.  
         */
        strip_diacritics(string_: string): string
        
        /** Returns `true` if [param string] is a valid identifier.  
         *  If the text server supports the [constant FEATURE_UNICODE_IDENTIFIERS] feature, a valid identifier must:  
         *  - Conform to normalization form C.  
         *  - Begin with a Unicode character of class XID_Start or `"_"`.  
         *  - May contain Unicode characters of class XID_Continue in the other positions.  
         *  - Use UAX #31 recommended scripts only (mixed scripts are allowed).  
         *  If the [constant FEATURE_UNICODE_IDENTIFIERS] feature is not supported, a valid identifier must:  
         *  - Begin with a Unicode character of class XID_Start or `"_"`.  
         *  - May contain Unicode characters of class XID_Continue in the other positions.  
         */
        is_valid_identifier(string_: string): boolean
        
        /** Returns `true` if the given code point is a valid letter, i.e. it belongs to the Unicode category "L". */
        is_valid_letter(unicode: int64): boolean
        
        /** Returns the string converted to `UPPERCASE`.  
         *      
         *  **Note:** Casing is locale dependent and context sensitive if server support [constant FEATURE_CONTEXT_SENSITIVE_CASE_CONVERSION] feature (supported by [TextServerAdvanced]).  
         *      
         *  **Note:** The result may be longer or shorter than the original.  
         */
        string_to_upper(string_: string, language?: string /* = '' */): string
        
        /** Returns the string converted to `lowercase`.  
         *      
         *  **Note:** Casing is locale dependent and context sensitive if server support [constant FEATURE_CONTEXT_SENSITIVE_CASE_CONVERSION] feature (supported by [TextServerAdvanced]).  
         *      
         *  **Note:** The result may be longer or shorter than the original.  
         */
        string_to_lower(string_: string, language?: string /* = '' */): string
        
        /** Returns the string converted to `Title Case`.  
         *      
         *  **Note:** Casing is locale dependent and context sensitive if server support [constant FEATURE_CONTEXT_SENSITIVE_CASE_CONVERSION] feature (supported by [TextServerAdvanced]).  
         *      
         *  **Note:** The result may be longer or shorter than the original.  
         */
        string_to_title(string_: string, language?: string /* = '' */): string
        
        /** Default implementation of the BiDi algorithm override function. */
        parse_structured_text(parser_type: TextServer.StructuredTextParser, args: GArray, text: string): GArray<Vector3i>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextServer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextServerAdvanced extends __NameMapTextServerExtension {
    }
    /** An advanced text server with support for BiDi, complex text layout, and contextual OpenType features. Used in Godot by default.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textserveradvanced.html  
     */
    class TextServerAdvanced extends TextServerExtension {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextServerAdvanced;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextServerDummy extends __NameMapTextServerExtension {
    }
    /** A dummy text server that can't render text or manage fonts.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textserverdummy.html  
     */
    class TextServerDummy extends TextServerExtension {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextServerDummy;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextServerExtension extends __NameMapTextServer {
    }
    /** Base class for custom [TextServer] implementations (plugins).  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textserverextension.html  
     */
    class TextServerExtension extends TextServer {
        constructor(identifier?: any)
        /** Returns `true` if the server supports a feature. */
        /* gdvirtual */ _has_feature(feature: TextServer.Feature): boolean
        
        /** Returns the name of the server interface. */
        /* gdvirtual */ _get_name(): string
        
        /** Returns text server features, see [enum TextServer.Feature]. */
        /* gdvirtual */ _get_features(): int64
        
        /** Frees an object created by this [TextServer]. */
        /* gdvirtual */ _free_rid(rid: RID): void
        
        /** Returns `true` if [param rid] is valid resource owned by this text server. */
        /* gdvirtual */ _has(rid: RID): boolean
        
        /** Loads optional TextServer database (e.g. ICU break iterators and dictionaries). */
        /* gdvirtual */ _load_support_data(filename: string): boolean
        
        /** Returns default TextServer database (e.g. ICU break iterators and dictionaries) filename. */
        /* gdvirtual */ _get_support_data_filename(): string
        
        /** Returns TextServer database (e.g. ICU break iterators and dictionaries) description. */
        /* gdvirtual */ _get_support_data_info(): string
        
        /** Saves optional TextServer database (e.g. ICU break iterators and dictionaries) to the file. */
        /* gdvirtual */ _save_support_data(filename: string): boolean
        
        /** Returns default TextServer database (e.g. ICU break iterators and dictionaries). */
        /* gdvirtual */ _get_support_data(): PackedByteArray
        
        /** Returns `true` if the locale requires text server support data for line/word breaking. */
        /* gdvirtual */ _is_locale_using_support_data(locale: string): boolean
        
        /** Returns `true` if locale is right-to-left. */
        /* gdvirtual */ _is_locale_right_to_left(locale: string): boolean
        
        /** Converts the given readable name of a feature, variation, script, or language to an OpenType tag. */
        /* gdvirtual */ _name_to_tag(name: string): int64
        
        /** Converts the given OpenType tag to the readable name of a feature, variation, script, or language. */
        /* gdvirtual */ _tag_to_name(tag: int64): string
        
        /** Creates a new, empty font cache entry resource. */
        /* gdvirtual */ _create_font(): RID
        
        /** Optional, implement if font supports extra spacing or baseline offset.  
         *  Creates a new variation existing font which is reusing the same glyph cache and font data.  
         */
        /* gdvirtual */ _create_font_linked_variation(font_rid: RID): RID
        
        /** Sets font source data, e.g contents of the dynamic font source file. */
        /* gdvirtual */ _font_set_data(font_rid: RID, data: PackedByteArray | byte[] | ArrayBuffer): void
        
        /** Sets pointer to the font source data, e.g contents of the dynamic font source file. */
        /* gdvirtual */ _font_set_data_ptr(font_rid: RID, data_ptr: int64, data_size: int64): void
        
        /** Sets an active face index in the TrueType / OpenType collection. */
        /* gdvirtual */ _font_set_face_index(font_rid: RID, face_index: int64): void
        
        /** Returns an active face index in the TrueType / OpenType collection. */
        /* gdvirtual */ _font_get_face_index(font_rid: RID): int64
        
        /** Returns number of faces in the TrueType / OpenType collection. */
        /* gdvirtual */ _font_get_face_count(font_rid: RID): int64
        
        /** Sets the font style flags. */
        /* gdvirtual */ _font_set_style(font_rid: RID, style: TextServer.FontStyle): void
        
        /** Returns font style flags. */
        /* gdvirtual */ _font_get_style(font_rid: RID): TextServer.FontStyle
        
        /** Sets the font family name. */
        /* gdvirtual */ _font_set_name(font_rid: RID, name: string): void
        
        /** Returns font family name. */
        /* gdvirtual */ _font_get_name(font_rid: RID): string
        
        /** Returns [Dictionary] with OpenType font name strings (localized font names, version, description, license information, sample text, etc.). */
        /* gdvirtual */ _font_get_ot_name_strings(font_rid: RID): GDictionary
        
        /** Sets the font style name. */
        /* gdvirtual */ _font_set_style_name(font_rid: RID, name_style: string): void
        
        /** Returns font style name. */
        /* gdvirtual */ _font_get_style_name(font_rid: RID): string
        
        /** Sets weight (boldness) of the font. A value in the `100...999` range, normal font weight is `400`, bold font weight is `700`. */
        /* gdvirtual */ _font_set_weight(font_rid: RID, weight: int64): void
        
        /** Returns weight (boldness) of the font. A value in the `100...999` range, normal font weight is `400`, bold font weight is `700`. */
        /* gdvirtual */ _font_get_weight(font_rid: RID): int64
        
        /** Sets font stretch amount, compared to a normal width. A percentage value between `50%` and `200%`. */
        /* gdvirtual */ _font_set_stretch(font_rid: RID, stretch: int64): void
        
        /** Returns font stretch amount, compared to a normal width. A percentage value between `50%` and `200%`. */
        /* gdvirtual */ _font_get_stretch(font_rid: RID): int64
        
        /** Sets font anti-aliasing mode. */
        /* gdvirtual */ _font_set_antialiasing(font_rid: RID, antialiasing: TextServer.FontAntialiasing): void
        
        /** Returns font anti-aliasing mode. */
        /* gdvirtual */ _font_get_antialiasing(font_rid: RID): TextServer.FontAntialiasing
        
        /** If set to `true`, embedded font bitmap loading is disabled. */
        /* gdvirtual */ _font_set_disable_embedded_bitmaps(font_rid: RID, disable_embedded_bitmaps: boolean): void
        
        /** Returns whether the font's embedded bitmap loading is disabled. */
        /* gdvirtual */ _font_get_disable_embedded_bitmaps(font_rid: RID): boolean
        
        /** If set to `true` font texture mipmap generation is enabled. */
        /* gdvirtual */ _font_set_generate_mipmaps(font_rid: RID, generate_mipmaps: boolean): void
        
        /** Returns `true` if font texture mipmap generation is enabled. */
        /* gdvirtual */ _font_get_generate_mipmaps(font_rid: RID): boolean
        
        /** If set to `true`, glyphs of all sizes are rendered using single multichannel signed distance field generated from the dynamic font vector data. MSDF rendering allows displaying the font at any scaling factor without blurriness, and without incurring a CPU cost when the font size changes (since the font no longer needs to be rasterized on the CPU). As a downside, font hinting is not available with MSDF. The lack of font hinting may result in less crisp and less readable fonts at small sizes. */
        /* gdvirtual */ _font_set_multichannel_signed_distance_field(font_rid: RID, msdf: boolean): void
        
        /** Returns `true` if glyphs of all sizes are rendered using single multichannel signed distance field generated from the dynamic font vector data. */
        /* gdvirtual */ _font_is_multichannel_signed_distance_field(font_rid: RID): boolean
        
        /** Sets the width of the range around the shape between the minimum and maximum representable signed distance. */
        /* gdvirtual */ _font_set_msdf_pixel_range(font_rid: RID, msdf_pixel_range: int64): void
        
        /** Returns the width of the range around the shape between the minimum and maximum representable signed distance. */
        /* gdvirtual */ _font_get_msdf_pixel_range(font_rid: RID): int64
        
        /** Sets source font size used to generate MSDF textures. */
        /* gdvirtual */ _font_set_msdf_size(font_rid: RID, msdf_size: int64): void
        
        /** Returns source font size used to generate MSDF textures. */
        /* gdvirtual */ _font_get_msdf_size(font_rid: RID): int64
        
        /** Sets bitmap font fixed size. If set to value greater than zero, same cache entry will be used for all font sizes. */
        /* gdvirtual */ _font_set_fixed_size(font_rid: RID, fixed_size: int64): void
        
        /** Returns bitmap font fixed size. */
        /* gdvirtual */ _font_get_fixed_size(font_rid: RID): int64
        
        /** Sets bitmap font scaling mode. This property is used only if `fixed_size` is greater than zero. */
        /* gdvirtual */ _font_set_fixed_size_scale_mode(font_rid: RID, fixed_size_scale_mode: TextServer.FixedSizeScaleMode): void
        
        /** Returns bitmap font scaling mode. */
        /* gdvirtual */ _font_get_fixed_size_scale_mode(font_rid: RID): TextServer.FixedSizeScaleMode
        
        /** If set to `true`, system fonts can be automatically used as fallbacks. */
        /* gdvirtual */ _font_set_allow_system_fallback(font_rid: RID, allow_system_fallback: boolean): void
        
        /** Returns `true` if system fonts can be automatically used as fallbacks. */
        /* gdvirtual */ _font_is_allow_system_fallback(font_rid: RID): boolean
        
        /** Frees all automatically loaded system fonts. */
        /* gdvirtual */ _font_clear_system_fallback_cache(): void
        
        /** If set to `true` auto-hinting is preferred over font built-in hinting. */
        /* gdvirtual */ _font_set_force_autohinter(font_rid: RID, force_autohinter: boolean): void
        
        /** Returns `true` if auto-hinting is supported and preferred over font built-in hinting. */
        /* gdvirtual */ _font_is_force_autohinter(font_rid: RID): boolean
        
        /** If set to `true`, color modulation is applied when drawing colored glyphs, otherwise it's applied to the monochrome glyphs only. */
        /* gdvirtual */ _font_set_modulate_color_glyphs(font_rid: RID, modulate: boolean): void
        
        /** Returns `true` if color modulation is applied when drawing the font's colored glyphs. */
        /* gdvirtual */ _font_is_modulate_color_glyphs(font_rid: RID): boolean
        
        /** Sets font hinting mode. Used by dynamic fonts only. */
        /* gdvirtual */ _font_set_hinting(font_rid: RID, hinting: TextServer.Hinting): void
        
        /** Returns the font hinting mode. Used by dynamic fonts only. */
        /* gdvirtual */ _font_get_hinting(font_rid: RID): TextServer.Hinting
        
        /** Sets font subpixel glyph positioning mode. */
        /* gdvirtual */ _font_set_subpixel_positioning(font_rid: RID, subpixel_positioning: TextServer.SubpixelPositioning): void
        
        /** Returns font subpixel glyph positioning mode. */
        /* gdvirtual */ _font_get_subpixel_positioning(font_rid: RID): TextServer.SubpixelPositioning
        
        /** Sets glyph position rounding behavior. If set to `true`, when aligning glyphs to the pixel boundaries rounding remainders are accumulated to ensure more uniform glyph distribution. This setting has no effect if subpixel positioning is enabled. */
        /* gdvirtual */ _font_set_keep_rounding_remainders(font_rid: RID, keep_rounding_remainders: boolean): void
        
        /** Returns glyph position rounding behavior. If set to `true`, when aligning glyphs to the pixel boundaries rounding remainders are accumulated to ensure more uniform glyph distribution. This setting has no effect if subpixel positioning is enabled. */
        /* gdvirtual */ _font_get_keep_rounding_remainders(font_rid: RID): boolean
        
        /** Sets font embolden strength. If [param strength] is not equal to zero, emboldens the font outlines. Negative values reduce the outline thickness. */
        /* gdvirtual */ _font_set_embolden(font_rid: RID, strength: float64): void
        
        /** Returns font embolden strength. */
        /* gdvirtual */ _font_get_embolden(font_rid: RID): float64
        
        /** Sets the spacing for [param spacing] to [param value] in pixels (not relative to the font size). */
        /* gdvirtual */ _font_set_spacing(font_rid: RID, spacing: TextServer.SpacingType, value: int64): void
        
        /** Returns the spacing for [param spacing] in pixels (not relative to the font size). */
        /* gdvirtual */ _font_get_spacing(font_rid: RID, spacing: TextServer.SpacingType): int64
        
        /** Sets extra baseline offset (as a fraction of font height). */
        /* gdvirtual */ _font_set_baseline_offset(font_rid: RID, baseline_offset: float64): void
        
        /** Returns extra baseline offset (as a fraction of font height). */
        /* gdvirtual */ _font_get_baseline_offset(font_rid: RID): float64
        
        /** Sets 2D transform, applied to the font outlines, can be used for slanting, flipping, and rotating glyphs. */
        /* gdvirtual */ _font_set_transform(font_rid: RID, transform: Transform2D): void
        
        /** Returns 2D transform applied to the font outlines. */
        /* gdvirtual */ _font_get_transform(font_rid: RID): Transform2D
        
        /** Sets variation coordinates for the specified font cache entry. */
        /* gdvirtual */ _font_set_variation_coordinates(font_rid: RID, variation_coordinates: GDictionary): void
        
        /** Returns variation coordinates for the specified font cache entry. */
        /* gdvirtual */ _font_get_variation_coordinates(font_rid: RID): GDictionary
        
        /** If set to a positive value, overrides the oversampling factor of the viewport this font is used in. See [member Viewport.oversampling]. This value doesn't override the [code skip-lint]oversampling` parameter of [code skip-lint]draw_*` methods. Used by dynamic fonts only. */
        /* gdvirtual */ _font_set_oversampling(font_rid: RID, oversampling: float64): void
        
        /** Returns oversampling factor override. If set to a positive value, overrides the oversampling factor of the viewport this font is used in. See [member Viewport.oversampling]. This value doesn't override the [code skip-lint]oversampling` parameter of [code skip-lint]draw_*` methods. Used by dynamic fonts only. */
        /* gdvirtual */ _font_get_oversampling(font_rid: RID): float64
        
        /** Returns list of the font sizes in the cache. Each size is [Vector2i] with font size and outline size. */
        /* gdvirtual */ _font_get_size_cache_list(font_rid: RID): GArray<Vector2i>
        
        /** Removes all font sizes from the cache entry. */
        /* gdvirtual */ _font_clear_size_cache(font_rid: RID): void
        
        /** Removes specified font size from the cache entry. */
        /* gdvirtual */ _font_remove_size_cache(font_rid: RID, size: Vector2i): void
        
        /** Returns font cache information, each entry contains the following fields: `Vector2i size_px` - font size in pixels, `float viewport_oversampling` - viewport oversampling factor, `int glyphs` - number of rendered glyphs, `int textures` - number of used textures, `int textures_size` - size of texture data in bytes. */
        /* gdvirtual */ _font_get_size_cache_info(font_rid: RID): GArray<GDictionary>
        
        /** Sets the font ascent (number of pixels above the baseline). */
        /* gdvirtual */ _font_set_ascent(font_rid: RID, size: int64, ascent: float64): void
        
        /** Returns the font ascent (number of pixels above the baseline). */
        /* gdvirtual */ _font_get_ascent(font_rid: RID, size: int64): float64
        
        /** Sets the font descent (number of pixels below the baseline). */
        /* gdvirtual */ _font_set_descent(font_rid: RID, size: int64, descent: float64): void
        
        /** Returns the font descent (number of pixels below the baseline). */
        /* gdvirtual */ _font_get_descent(font_rid: RID, size: int64): float64
        
        /** Sets pixel offset of the underline below the baseline. */
        /* gdvirtual */ _font_set_underline_position(font_rid: RID, size: int64, underline_position: float64): void
        
        /** Returns pixel offset of the underline below the baseline. */
        /* gdvirtual */ _font_get_underline_position(font_rid: RID, size: int64): float64
        
        /** Sets thickness of the underline in pixels. */
        /* gdvirtual */ _font_set_underline_thickness(font_rid: RID, size: int64, underline_thickness: float64): void
        
        /** Returns thickness of the underline in pixels. */
        /* gdvirtual */ _font_get_underline_thickness(font_rid: RID, size: int64): float64
        
        /** Sets scaling factor of the color bitmap font. */
        /* gdvirtual */ _font_set_scale(font_rid: RID, size: int64, scale: float64): void
        
        /** Returns scaling factor of the color bitmap font. */
        /* gdvirtual */ _font_get_scale(font_rid: RID, size: int64): float64
        
        /** Returns number of textures used by font cache entry. */
        /* gdvirtual */ _font_get_texture_count(font_rid: RID, size: Vector2i): int64
        
        /** Removes all textures from font cache entry. */
        /* gdvirtual */ _font_clear_textures(font_rid: RID, size: Vector2i): void
        
        /** Removes specified texture from the cache entry. */
        /* gdvirtual */ _font_remove_texture(font_rid: RID, size: Vector2i, texture_index: int64): void
        
        /** Sets font cache texture image data. */
        /* gdvirtual */ _font_set_texture_image(font_rid: RID, size: Vector2i, texture_index: int64, image: Image): void
        
        /** Returns font cache texture image data. */
        /* gdvirtual */ _font_get_texture_image(font_rid: RID, size: Vector2i, texture_index: int64): null | Image
        
        /** Sets array containing glyph packing data. */
        /* gdvirtual */ _font_set_texture_offsets(font_rid: RID, size: Vector2i, texture_index: int64, offset: PackedInt32Array | int32[]): void
        
        /** Returns array containing glyph packing data. */
        /* gdvirtual */ _font_get_texture_offsets(font_rid: RID, size: Vector2i, texture_index: int64): PackedInt32Array
        
        /** Returns list of rendered glyphs in the cache entry. */
        /* gdvirtual */ _font_get_glyph_list(font_rid: RID, size: Vector2i): PackedInt32Array
        
        /** Removes all rendered glyph information from the cache entry. */
        /* gdvirtual */ _font_clear_glyphs(font_rid: RID, size: Vector2i): void
        
        /** Removes specified rendered glyph information from the cache entry. */
        /* gdvirtual */ _font_remove_glyph(font_rid: RID, size: Vector2i, glyph: int64): void
        
        /** Returns glyph advance (offset of the next glyph). */
        /* gdvirtual */ _font_get_glyph_advance(font_rid: RID, size: int64, glyph: int64): Vector2
        
        /** Sets glyph advance (offset of the next glyph). */
        /* gdvirtual */ _font_set_glyph_advance(font_rid: RID, size: int64, glyph: int64, advance: Vector2): void
        
        /** Returns glyph offset from the baseline. */
        /* gdvirtual */ _font_get_glyph_offset(font_rid: RID, size: Vector2i, glyph: int64): Vector2
        
        /** Sets glyph offset from the baseline. */
        /* gdvirtual */ _font_set_glyph_offset(font_rid: RID, size: Vector2i, glyph: int64, offset: Vector2): void
        
        /** Returns size of the glyph. */
        /* gdvirtual */ _font_get_glyph_size(font_rid: RID, size: Vector2i, glyph: int64): Vector2
        
        /** Sets size of the glyph. */
        /* gdvirtual */ _font_set_glyph_size(font_rid: RID, size: Vector2i, glyph: int64, gl_size: Vector2): void
        
        /** Returns rectangle in the cache texture containing the glyph. */
        /* gdvirtual */ _font_get_glyph_uv_rect(font_rid: RID, size: Vector2i, glyph: int64): Rect2
        
        /** Sets rectangle in the cache texture containing the glyph. */
        /* gdvirtual */ _font_set_glyph_uv_rect(font_rid: RID, size: Vector2i, glyph: int64, uv_rect: Rect2): void
        
        /** Returns index of the cache texture containing the glyph. */
        /* gdvirtual */ _font_get_glyph_texture_idx(font_rid: RID, size: Vector2i, glyph: int64): int64
        
        /** Sets index of the cache texture containing the glyph. */
        /* gdvirtual */ _font_set_glyph_texture_idx(font_rid: RID, size: Vector2i, glyph: int64, texture_idx: int64): void
        
        /** Returns resource ID of the cache texture containing the glyph. */
        /* gdvirtual */ _font_get_glyph_texture_rid(font_rid: RID, size: Vector2i, glyph: int64): RID
        
        /** Returns size of the cache texture containing the glyph. */
        /* gdvirtual */ _font_get_glyph_texture_size(font_rid: RID, size: Vector2i, glyph: int64): Vector2
        
        /** Returns outline contours of the glyph. */
        /* gdvirtual */ _font_get_glyph_contours(font_rid: RID, size: int64, index: int64): GDictionary
        
        /** Returns list of the kerning overrides. */
        /* gdvirtual */ _font_get_kerning_list(font_rid: RID, size: int64): GArray<Vector2i>
        
        /** Removes all kerning overrides. */
        /* gdvirtual */ _font_clear_kerning_map(font_rid: RID, size: int64): void
        
        /** Removes kerning override for the pair of glyphs. */
        /* gdvirtual */ _font_remove_kerning(font_rid: RID, size: int64, glyph_pair: Vector2i): void
        
        /** Sets kerning for the pair of glyphs. */
        /* gdvirtual */ _font_set_kerning(font_rid: RID, size: int64, glyph_pair: Vector2i, kerning: Vector2): void
        
        /** Returns kerning for the pair of glyphs. */
        /* gdvirtual */ _font_get_kerning(font_rid: RID, size: int64, glyph_pair: Vector2i): Vector2
        
        /** Returns the glyph index of a [param char], optionally modified by the [param variation_selector]. */
        /* gdvirtual */ _font_get_glyph_index(font_rid: RID, size: int64, char: int64, variation_selector: int64): int64
        
        /** Returns character code associated with [param glyph_index], or `0` if [param glyph_index] is invalid. */
        /* gdvirtual */ _font_get_char_from_glyph_index(font_rid: RID, size: int64, glyph_index: int64): int64
        
        /** Returns `true` if a Unicode [param char] is available in the font. */
        /* gdvirtual */ _font_has_char(font_rid: RID, char: int64): boolean
        
        /** Returns a string containing all the characters available in the font. */
        /* gdvirtual */ _font_get_supported_chars(font_rid: RID): string
        
        /** Returns an array containing all glyph indices in the font. */
        /* gdvirtual */ _font_get_supported_glyphs(font_rid: RID): PackedInt32Array
        
        /** Renders the range of characters to the font cache texture. */
        /* gdvirtual */ _font_render_range(font_rid: RID, size: Vector2i, start: int64, end: int64): void
        
        /** Renders specified glyph to the font cache texture. */
        /* gdvirtual */ _font_render_glyph(font_rid: RID, size: Vector2i, index: int64): void
        
        /** Draws single glyph into a canvas item at the position, using [param font_rid] at the size [param size]. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        /* gdvirtual */ _font_draw_glyph(font_rid: RID, canvas: RID, size: int64, pos: Vector2, index: int64, color: Color, oversampling: float64): void
        
        /** Draws single glyph outline of size [param outline_size] into a canvas item at the position, using [param font_rid] at the size [param size]. If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        /* gdvirtual */ _font_draw_glyph_outline(font_rid: RID, canvas: RID, size: int64, outline_size: int64, pos: Vector2, index: int64, color: Color, oversampling: float64): void
        
        /** Returns `true` if the font supports the given language (as a [url=https://en.wikipedia.org/wiki/ISO_639-1]ISO 639[/url] code). */
        /* gdvirtual */ _font_is_language_supported(font_rid: RID, language: string): boolean
        
        /** Adds override for [method _font_is_language_supported]. */
        /* gdvirtual */ _font_set_language_support_override(font_rid: RID, language: string, supported: boolean): void
        
        /** Returns `true` if support override is enabled for the [param language]. */
        /* gdvirtual */ _font_get_language_support_override(font_rid: RID, language: string): boolean
        
        /** Remove language support override. */
        /* gdvirtual */ _font_remove_language_support_override(font_rid: RID, language: string): void
        
        /** Returns list of language support overrides. */
        /* gdvirtual */ _font_get_language_support_overrides(font_rid: RID): PackedStringArray
        
        /** Returns `true` if the font supports the given script (as a [url=https://en.wikipedia.org/wiki/ISO_15924]ISO 15924[/url] code). */
        /* gdvirtual */ _font_is_script_supported(font_rid: RID, script: string): boolean
        
        /** Adds override for [method _font_is_script_supported]. */
        /* gdvirtual */ _font_set_script_support_override(font_rid: RID, script: string, supported: boolean): void
        
        /** Returns `true` if support override is enabled for the [param script]. */
        /* gdvirtual */ _font_get_script_support_override(font_rid: RID, script: string): boolean
        
        /** Removes script support override. */
        /* gdvirtual */ _font_remove_script_support_override(font_rid: RID, script: string): void
        
        /** Returns list of script support overrides. */
        /* gdvirtual */ _font_get_script_support_overrides(font_rid: RID): PackedStringArray
        
        /** Sets font OpenType feature set override. */
        /* gdvirtual */ _font_set_opentype_feature_overrides(font_rid: RID, overrides: GDictionary): void
        
        /** Returns font OpenType feature set override. */
        /* gdvirtual */ _font_get_opentype_feature_overrides(font_rid: RID): GDictionary
        
        /** Returns the dictionary of the supported OpenType features. */
        /* gdvirtual */ _font_supported_feature_list(font_rid: RID): GDictionary
        
        /** Returns the dictionary of the supported OpenType variation coordinates. */
        /* gdvirtual */ _font_supported_variation_list(font_rid: RID): GDictionary
        
        /** Returns the font oversampling factor, shared by all fonts in the TextServer. */
        /* gdvirtual */ _font_get_global_oversampling(): float64
        
        /** Sets oversampling factor, shared by all font in the TextServer. */
        /* gdvirtual */ _font_set_global_oversampling(oversampling: float64): void
        
        /** Increases the reference count of the specified oversampling level. This method is called by [Viewport], and should not be used directly. */
        /* gdvirtual */ _reference_oversampling_level(oversampling: float64): void
        
        /** Decreases the reference count of the specified oversampling level, and frees the font cache for oversampling level when the reference count reaches zero. This method is called by [Viewport], and should not be used directly. */
        /* gdvirtual */ _unreference_oversampling_level(oversampling: float64): void
        
        /** Returns size of the replacement character (box with character hexadecimal code that is drawn in place of invalid characters). */
        /* gdvirtual */ _get_hex_code_box_size(size: int64, index: int64): Vector2
        
        /** Draws box displaying character hexadecimal code. */
        /* gdvirtual */ _draw_hex_code_box(canvas: RID, size: int64, pos: Vector2, index: int64, color: Color): void
        
        /** Creates a new buffer for complex text layout, with the given [param direction] and [param orientation]. */
        /* gdvirtual */ _create_shaped_text(direction: TextServer.Direction, orientation: TextServer.Orientation): RID
        
        /** Clears text buffer (removes text and inline objects). */
        /* gdvirtual */ _shaped_text_clear(shaped: RID): void
        
        /** Duplicates shaped text buffer. */
        /* gdvirtual */ _shaped_text_duplicate(shaped: RID): RID
        
        /** Sets desired text direction. If set to [constant TextServer.DIRECTION_AUTO], direction will be detected based on the buffer contents and current locale. */
        /* gdvirtual */ _shaped_text_set_direction(shaped: RID, direction: TextServer.Direction): void
        
        /** Returns direction of the text. */
        /* gdvirtual */ _shaped_text_get_direction(shaped: RID): TextServer.Direction
        
        /** Returns direction of the text, inferred by the BiDi algorithm. */
        /* gdvirtual */ _shaped_text_get_inferred_direction(shaped: RID): TextServer.Direction
        
        /** Overrides BiDi for the structured text. */
        /* gdvirtual */ _shaped_text_set_bidi_override(shaped: RID, override: GArray): void
        
        /** Sets custom punctuation character list, used for word breaking. If set to empty string, server defaults are used. */
        /* gdvirtual */ _shaped_text_set_custom_punctuation(shaped: RID, punct: string): void
        
        /** Returns custom punctuation character list, used for word breaking. If set to empty string, server defaults are used. */
        /* gdvirtual */ _shaped_text_get_custom_punctuation(shaped: RID): string
        
        /** Sets ellipsis character used for text clipping. */
        /* gdvirtual */ _shaped_text_set_custom_ellipsis(shaped: RID, char: int64): void
        
        /** Returns ellipsis character used for text clipping. */
        /* gdvirtual */ _shaped_text_get_custom_ellipsis(shaped: RID): int64
        
        /** Sets desired text orientation. */
        /* gdvirtual */ _shaped_text_set_orientation(shaped: RID, orientation: TextServer.Orientation): void
        
        /** Returns text orientation. */
        /* gdvirtual */ _shaped_text_get_orientation(shaped: RID): TextServer.Orientation
        
        /** If set to `true` text buffer will display invalid characters as hexadecimal codes, otherwise nothing is displayed. */
        /* gdvirtual */ _shaped_text_set_preserve_invalid(shaped: RID, enabled: boolean): void
        
        /** Returns `true` if text buffer is configured to display hexadecimal codes in place of invalid characters. */
        /* gdvirtual */ _shaped_text_get_preserve_invalid(shaped: RID): boolean
        
        /** If set to `true` text buffer will display control characters. */
        /* gdvirtual */ _shaped_text_set_preserve_control(shaped: RID, enabled: boolean): void
        
        /** Returns `true` if text buffer is configured to display control characters. */
        /* gdvirtual */ _shaped_text_get_preserve_control(shaped: RID): boolean
        
        /** Sets extra spacing added between glyphs or lines in pixels. */
        /* gdvirtual */ _shaped_text_set_spacing(shaped: RID, spacing: TextServer.SpacingType, value: int64): void
        
        /** Returns extra spacing added between glyphs or lines in pixels. */
        /* gdvirtual */ _shaped_text_get_spacing(shaped: RID, spacing: TextServer.SpacingType): int64
        
        /** Adds text span and font to draw it to the text buffer. */
        /* gdvirtual */ _shaped_text_add_string(shaped: RID, text: string, fonts: GArray<RID>, size: int64, opentype_features: GDictionary, language: string, meta: any): boolean
        
        /** Adds inline object to the text buffer, [param key] must be unique. In the text, object is represented as [param length] object replacement characters. */
        /* gdvirtual */ _shaped_text_add_object(shaped: RID, key: any, size: Vector2, inline_align: InlineAlignment, length: int64, baseline: float64): boolean
        
        /** Sets new size and alignment of embedded object. */
        /* gdvirtual */ _shaped_text_resize_object(shaped: RID, key: any, size: Vector2, inline_align: InlineAlignment, baseline: float64): boolean
        
        /** Returns `true` if an object with [param key] is embedded in this shaped text buffer. */
        /* gdvirtual */ _shaped_text_has_object(shaped: RID, key: any): boolean
        
        /** Returns the text buffer source text, including object replacement characters. */
        /* gdvirtual */ _shaped_get_text(shaped: RID): string
        
        /** Returns number of text spans added using [method _shaped_text_add_string] or [method _shaped_text_add_object]. */
        /* gdvirtual */ _shaped_get_span_count(shaped: RID): int64
        
        /** Returns text span metadata. */
        /* gdvirtual */ _shaped_get_span_meta(shaped: RID, index: int64): any
        
        /** Returns text embedded object key. */
        /* gdvirtual */ _shaped_get_span_embedded_object(shaped: RID, index: int64): any
        
        /** Returns the text span source text. */
        /* gdvirtual */ _shaped_get_span_text(shaped: RID, index: int64): string
        
        /** Returns the text span embedded object key. */
        /* gdvirtual */ _shaped_get_span_object(shaped: RID, index: int64): any
        
        /** Changes text span font, font size, and OpenType features, without changing the text. */
        /* gdvirtual */ _shaped_set_span_update_font(shaped: RID, index: int64, fonts: GArray<RID>, size: int64, opentype_features: GDictionary): void
        
        /** Returns the number of uniform text runs in the buffer. */
        /* gdvirtual */ _shaped_get_run_count(shaped: RID): int64
        
        /** Returns the source text of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_text(shaped: RID, index: int64): string
        
        /** Returns the source text range of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_range(shaped: RID, index: int64): Vector2i
        
        /** Returns the font RID of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_font_rid(shaped: RID, index: int64): RID
        
        /** Returns the font size of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_font_size(shaped: RID, index: int64): int64
        
        /** Returns the language of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_language(shaped: RID, index: int64): string
        
        /** Returns the direction of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_direction(shaped: RID, index: int64): TextServer.Direction
        
        /** Returns the embedded object of the [param index] text run (in visual order). */
        /* gdvirtual */ _shaped_get_run_object(shaped: RID, index: int64): any
        
        /** Returns text buffer for the substring of the text in the [param shaped] text buffer (including inline objects). */
        /* gdvirtual */ _shaped_text_substr(shaped: RID, start: int64, length: int64): RID
        
        /** Returns the parent buffer from which the substring originates. */
        /* gdvirtual */ _shaped_text_get_parent(shaped: RID): RID
        
        /** Adjusts text width to fit to specified width, returns new text width. */
        /* gdvirtual */ _shaped_text_fit_to_width(shaped: RID, width: float64, justification_flags: TextServer.JustificationFlag): float64
        
        /** Aligns shaped text to the given tab-stops. */
        /* gdvirtual */ _shaped_text_tab_align(shaped: RID, tab_stops: PackedFloat32Array | float32[]): float64
        
        /** Shapes buffer if it's not shaped. Returns `true` if the string is shaped successfully. */
        /* gdvirtual */ _shaped_text_shape(shaped: RID): boolean
        
        /** Updates break points in the shaped text. This method is called by default implementation of text breaking functions. */
        /* gdvirtual */ _shaped_text_update_breaks(shaped: RID): boolean
        
        /** Updates justification points in the shaped text. This method is called by default implementation of text justification functions. */
        /* gdvirtual */ _shaped_text_update_justification_ops(shaped: RID): boolean
        
        /** Returns `true` if buffer is successfully shaped. */
        /* gdvirtual */ _shaped_text_is_ready(shaped: RID): boolean
        
        /** Returns an array of glyphs in the visual order. */
        /* gdvirtual */ _shaped_text_get_glyphs(shaped: RID): int64
        
        /** Returns text glyphs in the logical order. */
        /* gdvirtual */ _shaped_text_sort_logical(shaped: RID): int64
        
        /** Returns number of glyphs in the buffer. */
        /* gdvirtual */ _shaped_text_get_glyph_count(shaped: RID): int64
        
        /** Returns substring buffer character range in the parent buffer. */
        /* gdvirtual */ _shaped_text_get_range(shaped: RID): Vector2i
        
        /** Breaks text to the lines and columns. Returns character ranges for each segment. */
        /* gdvirtual */ _shaped_text_get_line_breaks_adv(shaped: RID, width: PackedFloat32Array | float32[], start: int64, once: boolean, break_flags: TextServer.LineBreakFlag): PackedInt32Array
        
        /** Breaks text to the lines and returns character ranges for each line. */
        /* gdvirtual */ _shaped_text_get_line_breaks(shaped: RID, width: float64, start: int64, break_flags: TextServer.LineBreakFlag): PackedInt32Array
        
        /** Breaks text into words and returns array of character ranges. Use [param grapheme_flags] to set what characters are used for breaking. */
        /* gdvirtual */ _shaped_text_get_word_breaks(shaped: RID, grapheme_flags: TextServer.GraphemeFlag, skip_grapheme_flags: TextServer.GraphemeFlag): PackedInt32Array
        
        /** Returns the position of the overrun trim. */
        /* gdvirtual */ _shaped_text_get_trim_pos(shaped: RID): int64
        
        /** Returns position of the ellipsis. */
        /* gdvirtual */ _shaped_text_get_ellipsis_pos(shaped: RID): int64
        
        /** Returns number of glyphs in the ellipsis. */
        /* gdvirtual */ _shaped_text_get_ellipsis_glyph_count(shaped: RID): int64
        
        /** Returns array of the glyphs in the ellipsis. */
        /* gdvirtual */ _shaped_text_get_ellipsis_glyphs(shaped: RID): int64
        
        /** Trims text if it exceeds the given width. */
        /* gdvirtual */ _shaped_text_overrun_trim_to_width(shaped: RID, width: float64, trim_flags: TextServer.TextOverrunFlag): void
        
        /** Returns array of inline objects. */
        /* gdvirtual */ _shaped_text_get_objects(shaped: RID): GArray
        
        /** Returns bounding rectangle of the inline object. */
        /* gdvirtual */ _shaped_text_get_object_rect(shaped: RID, key: any): Rect2
        
        /** Returns the character range of the inline object. */
        /* gdvirtual */ _shaped_text_get_object_range(shaped: RID, key: any): Vector2i
        
        /** Returns the glyph index of the inline object. */
        /* gdvirtual */ _shaped_text_get_object_glyph(shaped: RID, key: any): int64
        
        /** Returns size of the text. */
        /* gdvirtual */ _shaped_text_get_size(shaped: RID): Vector2
        
        /** Returns the text ascent (number of pixels above the baseline for horizontal layout or to the left of baseline for vertical). */
        /* gdvirtual */ _shaped_text_get_ascent(shaped: RID): float64
        
        /** Returns the text descent (number of pixels below the baseline for horizontal layout or to the right of baseline for vertical). */
        /* gdvirtual */ _shaped_text_get_descent(shaped: RID): float64
        
        /** Returns width (for horizontal layout) or height (for vertical) of the text. */
        /* gdvirtual */ _shaped_text_get_width(shaped: RID): float64
        
        /** Returns pixel offset of the underline below the baseline. */
        /* gdvirtual */ _shaped_text_get_underline_position(shaped: RID): float64
        
        /** Returns thickness of the underline. */
        /* gdvirtual */ _shaped_text_get_underline_thickness(shaped: RID): float64
        
        /** Returns dominant direction of in the range of text. */
        /* gdvirtual */ _shaped_text_get_dominant_direction_in_range(shaped: RID, start: int64, end: int64): int64
        
        /** Returns shapes of the carets corresponding to the character offset [param position] in the text. Returned caret shape is 1 pixel wide rectangle. */
        /* gdvirtual */ _shaped_text_get_carets(shaped: RID, position: int64, caret: int64): void
        
        /** Returns selection rectangles for the specified character range. */
        /* gdvirtual */ _shaped_text_get_selection(shaped: RID, start: int64, end: int64): PackedVector2Array
        
        /** Returns grapheme index at the specified pixel offset at the baseline, or `-1` if none is found. */
        /* gdvirtual */ _shaped_text_hit_test_grapheme(shaped: RID, coord: float64): int64
        
        /** Returns caret character offset at the specified pixel offset at the baseline. This function always returns a valid position. */
        /* gdvirtual */ _shaped_text_hit_test_position(shaped: RID, coord: float64): int64
        
        /** Draw shaped text into a canvas item at a given position, with [param color]. [param pos] specifies the leftmost point of the baseline (for horizontal layout) or topmost point of the baseline (for vertical layout). If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        /* gdvirtual */ _shaped_text_draw(shaped: RID, canvas: RID, pos: Vector2, clip_l: float64, clip_r: float64, color: Color, oversampling: float64): void
        
        /** Draw the outline of the shaped text into a canvas item at a given position, with [param color]. [param pos] specifies the leftmost point of the baseline (for horizontal layout) or topmost point of the baseline (for vertical layout). If [param oversampling] is greater than zero, it is used as font oversampling factor, otherwise viewport oversampling settings are used. */
        /* gdvirtual */ _shaped_text_draw_outline(shaped: RID, canvas: RID, pos: Vector2, clip_l: float64, clip_r: float64, outline_size: int64, color: Color, oversampling: float64): void
        
        /** Returns composite character's bounds as offsets from the start of the line. */
        /* gdvirtual */ _shaped_text_get_grapheme_bounds(shaped: RID, pos: int64): Vector2
        
        /** Returns grapheme end position closest to the [param pos]. */
        /* gdvirtual */ _shaped_text_next_grapheme_pos(shaped: RID, pos: int64): int64
        
        /** Returns grapheme start position closest to the [param pos]. */
        /* gdvirtual */ _shaped_text_prev_grapheme_pos(shaped: RID, pos: int64): int64
        
        /** Returns array of the composite character boundaries. */
        /* gdvirtual */ _shaped_text_get_character_breaks(shaped: RID): PackedInt32Array
        
        /** Returns composite character end position closest to the [param pos]. */
        /* gdvirtual */ _shaped_text_next_character_pos(shaped: RID, pos: int64): int64
        
        /** Returns composite character start position closest to the [param pos]. */
        /* gdvirtual */ _shaped_text_prev_character_pos(shaped: RID, pos: int64): int64
        
        /** Returns composite character position closest to the [param pos]. */
        /* gdvirtual */ _shaped_text_closest_character_pos(shaped: RID, pos: int64): int64
        
        /** Converts a number from Western Arabic (0..9) to the numeral system used in the given [param language].  
         *  If [param language] is an empty string, the active locale will be used.  
         */
        /* gdvirtual */ _format_number(number: string, language: string): string
        
        /** Converts [param number] from the numeral system used in the given [param language] to Western Arabic (0..9).  
         *  If [param language] is an empty string, the active locale will be used.  
         */
        /* gdvirtual */ _parse_number(number: string, language: string): string
        
        /** Returns percent sign used in the given [param language]. */
        /* gdvirtual */ _percent_sign(language: string): string
        
        /** Strips diacritics from the string. */
        /* gdvirtual */ _strip_diacritics(string_: string): string
        
        /** Returns `true` if [param string] is a valid identifier. */
        /* gdvirtual */ _is_valid_identifier(string_: string): boolean
        /* gdvirtual */ _is_valid_letter(unicode: int64): boolean
        
        /** Returns an array of the word break boundaries. Elements in the returned array are the offsets of the start and end of words. Therefore the length of the array is always even. */
        /* gdvirtual */ _string_get_word_breaks(string_: string, language: string, chars_per_line: int64): PackedInt32Array
        
        /** Returns array of the composite character boundaries. */
        /* gdvirtual */ _string_get_character_breaks(string_: string, language: string): PackedInt32Array
        
        /** Returns index of the first string in [param dict] which is visually confusable with the [param string], or `-1` if none is found. */
        /* gdvirtual */ _is_confusable(string_: string, dict: PackedStringArray | string[]): int64
        
        /** Returns `true` if [param string] is likely to be an attempt at confusing the reader. */
        /* gdvirtual */ _spoof_check(string_: string): boolean
        
        /** Returns the string converted to `UPPERCASE`. */
        /* gdvirtual */ _string_to_upper(string_: string, language: string): string
        
        /** Returns the string converted to `lowercase`. */
        /* gdvirtual */ _string_to_lower(string_: string, language: string): string
        
        /** Returns the string converted to `Title Case`. */
        /* gdvirtual */ _string_to_title(string_: string, language: string): string
        
        /** Default implementation of the BiDi algorithm override function. */
        /* gdvirtual */ _parse_structured_text(parser_type: TextServer.StructuredTextParser, args: GArray, text: string): GArray<Vector3i>
        
        /** This method is called before text server is unregistered. */
        /* gdvirtual */ _cleanup(): void
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextServerExtension;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextServerFallback extends __NameMapTextServerExtension {
    }
    /** A fallback implementation of Godot's text server, without support for BiDi and complex text layout.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textserverfallback.html  
     */
    class TextServerFallback extends TextServerExtension {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextServerFallback;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture extends __NameMapResource {
    }
    /** Base class for all texture types.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture.html  
     */
    class Texture extends Resource {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture2D extends __NameMapTexture {
    }
    /** Texture for 2D and 3D.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture2d.html  
     */
    class Texture2D extends Texture {
        constructor(identifier?: any)
        /** Called when the [Texture2D]'s width is queried. */
        /* gdvirtual */ _get_width(): int64
        
        /** Called when the [Texture2D]'s height is queried. */
        /* gdvirtual */ _get_height(): int64
        
        /** Called when a pixel's opaque state in the [Texture2D] is queried at the specified `(x, y)` position. */
        /* gdvirtual */ _is_pixel_opaque(x: int64, y: int64): boolean
        
        /** Called when the presence of an alpha channel in the [Texture2D] is queried. */
        /* gdvirtual */ _has_alpha(): boolean
        
        /** Called when the entire [Texture2D] is requested to be drawn over a [CanvasItem], with the top-left offset specified in [param pos]. [param modulate] specifies a multiplier for the colors being drawn, while [param transpose] specifies whether drawing should be performed in column-major order instead of row-major order (resulting in 90-degree clockwise rotation).  
         *      
         *  **Note:** This is only used in 2D rendering, not 3D.  
         */
        /* gdvirtual */ _draw(to_canvas_item: RID, pos: Vector2, modulate: Color, transpose: boolean): void
        
        /** Called when the [Texture2D] is requested to be drawn onto [CanvasItem]'s specified [param rect]. [param modulate] specifies a multiplier for the colors being drawn, while [param transpose] specifies whether drawing should be performed in column-major order instead of row-major order (resulting in 90-degree clockwise rotation).  
         *      
         *  **Note:** This is only used in 2D rendering, not 3D.  
         */
        /* gdvirtual */ _draw_rect(to_canvas_item: RID, rect: Rect2, tile: boolean, modulate: Color, transpose: boolean): void
        
        /** Called when a part of the [Texture2D] specified by [param src_rect]'s coordinates is requested to be drawn onto [CanvasItem]'s specified [param rect]. [param modulate] specifies a multiplier for the colors being drawn, while [param transpose] specifies whether drawing should be performed in column-major order instead of row-major order (resulting in 90-degree clockwise rotation).  
         *      
         *  **Note:** This is only used in 2D rendering, not 3D.  
         */
        /* gdvirtual */ _draw_rect_region(to_canvas_item: RID, rect: Rect2, src_rect: Rect2, modulate: Color, transpose: boolean, clip_uv: boolean): void
        
        /** Returns the texture width in pixels. */
        get_width(): int64
        
        /** Returns the texture height in pixels. */
        get_height(): int64
        
        /** Returns the texture size in pixels. */
        get_size(): Vector2
        
        /** Returns `true` if this [Texture2D] has an alpha channel. */
        has_alpha(): boolean
        
        /** Draws the texture using a [CanvasItem] with the [RenderingServer] API at the specified [param position]. */
        draw(canvas_item: RID, position: Vector2, modulate?: Color /* = new Color(1, 1, 1, 1) */, transpose?: boolean /* = false */): void
        
        /** Draws the texture using a [CanvasItem] with the [RenderingServer] API. */
        draw_rect(canvas_item: RID, rect: Rect2, tile: boolean, modulate?: Color /* = new Color(1, 1, 1, 1) */, transpose?: boolean /* = false */): void
        
        /** Draws a part of the texture using a [CanvasItem] with the [RenderingServer] API. */
        draw_rect_region(canvas_item: RID, rect: Rect2, src_rect: Rect2, modulate?: Color /* = new Color(1, 1, 1, 1) */, transpose?: boolean /* = false */, clip_uv?: boolean /* = true */): void
        
        /** Returns an [Image] that is a copy of data from this [Texture2D] (a new [Image] is created each time). [Image]s can be accessed and manipulated directly.  
         *      
         *  **Note:** This will return `null` if this [Texture2D] is invalid.  
         *      
         *  **Note:** This will fetch the texture data from the GPU, which might cause performance problems when overused. Avoid calling [method get_image] every frame, especially on large textures.  
         */
        get_image(): null | Image
        
        /** Creates a placeholder version of this resource ([PlaceholderTexture2D]). */
        create_placeholder(): Resource
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture2D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture2DArray extends __NameMapImageTextureLayered {
    }
    /** A single texture resource which consists of multiple, separate images. Each image has the same dimensions and number of mipmap levels.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture2darray.html  
     */
    class Texture2DArray extends ImageTextureLayered {
        constructor(identifier?: any)
        /** Creates a placeholder version of this resource ([PlaceholderTexture2DArray]). */
        create_placeholder(): Resource
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture2DArray;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture2DArrayRD extends __NameMapTextureLayeredRD {
    }
    /** Texture Array for 2D that is bound to a texture created on the [RenderingDevice].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture2darrayrd.html  
     */
    class Texture2DArrayRD extends TextureLayeredRD {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture2DArrayRD;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture2DRD extends __NameMapTexture2D {
    }
    /** Texture for 2D that is bound to a texture created on the [RenderingDevice].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture2drd.html  
     */
    class Texture2DRD extends Texture2D {
        constructor(identifier?: any)
        /** The RID of the texture object created on the [RenderingDevice]. */
        get texture_rd_rid(): RID
        set texture_rd_rid(value: RID)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture2DRD;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture3D extends __NameMapTexture {
    }
    /** Base class for 3-dimensional textures.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture3d.html  
     */
    class Texture3D extends Texture {
        constructor(identifier?: any)
        /** Called when the [Texture3D]'s format is queried. */
        /* gdvirtual */ _get_format(): Image.Format
        
        /** Called when the [Texture3D]'s width is queried. */
        /* gdvirtual */ _get_width(): int64
        
        /** Called when the [Texture3D]'s height is queried. */
        /* gdvirtual */ _get_height(): int64
        
        /** Called when the [Texture3D]'s depth is queried. */
        /* gdvirtual */ _get_depth(): int64
        
        /** Called when the presence of mipmaps in the [Texture3D] is queried. */
        /* gdvirtual */ _has_mipmaps(): boolean
        
        /** Called when the [Texture3D]'s data is queried. */
        /* gdvirtual */ _get_data(): GArray<Image>
        
        /** Returns the current format being used by this texture. */
        get_format(): Image.Format
        
        /** Returns the [Texture3D]'s width in pixels. Width is typically represented by the X axis. */
        get_width(): int64
        
        /** Returns the [Texture3D]'s height in pixels. Width is typically represented by the Y axis. */
        get_height(): int64
        
        /** Returns the [Texture3D]'s depth in pixels. Depth is typically represented by the Z axis (a dimension not present in [Texture2D]). */
        get_depth(): int64
        
        /** Returns `true` if the [Texture3D] has generated mipmaps. */
        has_mipmaps(): boolean
        
        /** Returns the [Texture3D]'s data as an array of [Image]s. Each [Image] represents a  *slice*  of the [Texture3D], with different slices mapping to different depth (Z axis) levels. */
        get_data(): GArray<Image>
        
        /** Creates a placeholder version of this resource ([PlaceholderTexture3D]). */
        create_placeholder(): Resource
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture3D;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTexture3DRD extends __NameMapTexture3D {
    }
    /** Texture for 3D that is bound to a texture created on the [RenderingDevice].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texture3drd.html  
     */
    class Texture3DRD extends Texture3D {
        constructor(identifier?: any)
        /** The RID of the texture object created on the [RenderingDevice]. */
        get texture_rd_rid(): RID
        set texture_rd_rid(value: RID)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTexture3DRD;
    }
    namespace TextureButton {
        enum StretchMode {
            /** Scale to fit the node's bounding rectangle. */
            STRETCH_SCALE = 0,
            
            /** Tile inside the node's bounding rectangle. */
            STRETCH_TILE = 1,
            
            /** The texture keeps its original size and stays in the bounding rectangle's top-left corner. */
            STRETCH_KEEP = 2,
            
            /** The texture keeps its original size and stays centered in the node's bounding rectangle. */
            STRETCH_KEEP_CENTERED = 3,
            
            /** Scale the texture to fit the node's bounding rectangle, but maintain the texture's aspect ratio. */
            STRETCH_KEEP_ASPECT = 4,
            
            /** Scale the texture to fit the node's bounding rectangle, center it, and maintain its aspect ratio. */
            STRETCH_KEEP_ASPECT_CENTERED = 5,
            
            /** Scale the texture so that the shorter side fits the bounding rectangle. The other side clips to the node's limits. */
            STRETCH_KEEP_ASPECT_COVERED = 6,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureButton extends __NameMapBaseButton {
    }
    /** Texture-based button. Supports Pressed, Hover, Disabled and Focused states.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texturebutton.html  
     */
    class TextureButton<Map extends NodePathMap = any> extends BaseButton<Map> {
        constructor(identifier?: any)
        /** Texture to display by default, when the node is **not** in the disabled, hover or pressed state. This texture is still displayed in the focused state, with [member texture_focused] drawn on top. */
        get texture_normal(): null | Texture2D
        set texture_normal(value: null | Texture2D)
        
        /** Texture to display on mouse down over the node, if the node has keyboard focus and the player presses the Enter key or if the player presses the [member BaseButton.shortcut] key. If not assigned, the [TextureButton] displays [member texture_hover] instead when pressed. */
        get texture_pressed(): null | Texture2D
        set texture_pressed(value: null | Texture2D)
        
        /** Texture to display when the mouse hovers over the node. If not assigned, the [TextureButton] displays [member texture_normal] instead when hovered over. */
        get texture_hover(): null | Texture2D
        set texture_hover(value: null | Texture2D)
        
        /** Texture to display when the node is disabled. See [member BaseButton.disabled]. If not assigned, the [TextureButton] displays [member texture_normal] instead. */
        get texture_disabled(): null | Texture2D
        set texture_disabled(value: null | Texture2D)
        
        /** Texture to  *overlay on the base texture*  when the node has mouse or keyboard focus. Because [member texture_focused] is displayed on top of the base texture, a partially transparent texture should be used to ensure the base texture remains visible. A texture that represents an outline or an underline works well for this purpose. To disable the focus visual effect, assign a fully transparent texture of any size. Note that disabling the focus visual effect will harm keyboard/controller navigation usability, so this is not recommended for accessibility reasons. */
        get texture_focused(): null | Texture2D
        set texture_focused(value: null | Texture2D)
        
        /** Pure black and white [BitMap] image to use for click detection. On the mask, white pixels represent the button's clickable area. Use it to create buttons with curved shapes. */
        get texture_click_mask(): null | BitMap
        set texture_click_mask(value: null | BitMap)
        
        /** If `true`, the size of the texture won't be considered for minimum size calculation, so the [TextureButton] can be shrunk down past the texture size. */
        get ignore_texture_size(): boolean
        set ignore_texture_size(value: boolean)
        
        /** Controls the texture's behavior when you resize the node's bounding rectangle. See the [enum StretchMode] constants for available options. */
        get stretch_mode(): int64
        set stretch_mode(value: int64)
        
        /** If `true`, texture is flipped horizontally. */
        get flip_h(): boolean
        set flip_h(value: boolean)
        
        /** If `true`, texture is flipped vertically. */
        get flip_v(): boolean
        set flip_v(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureButton;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureCubemapArrayRD extends __NameMapTextureLayeredRD {
    }
    /** Texture Array for Cubemaps that is bound to a texture created on the [RenderingDevice].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texturecubemaparrayrd.html  
     */
    class TextureCubemapArrayRD extends TextureLayeredRD {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureCubemapArrayRD;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureCubemapRD extends __NameMapTextureLayeredRD {
    }
    /** Texture for Cubemap that is bound to a texture created on the [RenderingDevice].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texturecubemaprd.html  
     */
    class TextureCubemapRD extends TextureLayeredRD {
        constructor(identifier?: any)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureCubemapRD;
    }
    namespace TextureLayered {
        enum LayeredType {
            /** Texture is a generic [Texture2DArray]. */
            LAYERED_TYPE_2D_ARRAY = 0,
            
            /** Texture is a [Cubemap], with each side in its own layer (6 in total). */
            LAYERED_TYPE_CUBEMAP = 1,
            
            /** Texture is a [CubemapArray], with each cubemap being made of 6 layers. */
            LAYERED_TYPE_CUBEMAP_ARRAY = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureLayered extends __NameMapTexture {
    }
    /** Base class for texture types which contain the data of multiple [Image]s. Each image is of the same size and format.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texturelayered.html  
     */
    class TextureLayered extends Texture {
        constructor(identifier?: any)
        /** Called when the [TextureLayered]'s format is queried. */
        /* gdvirtual */ _get_format(): Image.Format
        
        /** Called when the layers' type in the [TextureLayered] is queried. */
        /* gdvirtual */ _get_layered_type(): int64
        
        /** Called when the [TextureLayered]'s width queried. */
        /* gdvirtual */ _get_width(): int64
        
        /** Called when the [TextureLayered]'s height is queried. */
        /* gdvirtual */ _get_height(): int64
        
        /** Called when the number of layers in the [TextureLayered] is queried. */
        /* gdvirtual */ _get_layers(): int64
        
        /** Called when the presence of mipmaps in the [TextureLayered] is queried. */
        /* gdvirtual */ _has_mipmaps(): boolean
        
        /** Called when the data for a layer in the [TextureLayered] is queried. */
        /* gdvirtual */ _get_layer_data(layer_index: int64): null | Image
        
        /** Returns the current format being used by this texture. */
        get_format(): Image.Format
        
        /** Returns the [TextureLayered]'s type. The type determines how the data is accessed, with cubemaps having special types. */
        get_layered_type(): TextureLayered.LayeredType
        
        /** Returns the width of the texture in pixels. Width is typically represented by the X axis. */
        get_width(): int64
        
        /** Returns the height of the texture in pixels. Height is typically represented by the Y axis. */
        get_height(): int64
        
        /** Returns the number of referenced [Image]s. */
        get_layers(): int64
        
        /** Returns `true` if the layers have generated mipmaps. */
        has_mipmaps(): boolean
        
        /** Returns an [Image] resource with the data from specified [param layer]. */
        get_layer_data(layer: int64): null | Image
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureLayered;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureLayeredRD extends __NameMapTextureLayered {
    }
    /** Abstract base class for layered texture RD types.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texturelayeredrd.html  
     */
    class TextureLayeredRD extends TextureLayered {
        constructor(identifier?: any)
        /** The RID of the texture object created on the [RenderingDevice]. */
        get texture_rd_rid(): RID
        set texture_rd_rid(value: RID)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureLayeredRD;
    }
    namespace TextureProgressBar {
        enum FillMode {
            /** The [member texture_progress] fills from left to right. */
            FILL_LEFT_TO_RIGHT = 0,
            
            /** The [member texture_progress] fills from right to left. */
            FILL_RIGHT_TO_LEFT = 1,
            
            /** The [member texture_progress] fills from top to bottom. */
            FILL_TOP_TO_BOTTOM = 2,
            
            /** The [member texture_progress] fills from bottom to top. */
            FILL_BOTTOM_TO_TOP = 3,
            
            /** Turns the node into a radial bar. The [member texture_progress] fills clockwise. See [member radial_center_offset], [member radial_initial_angle] and [member radial_fill_degrees] to control the way the bar fills up. */
            FILL_CLOCKWISE = 4,
            
            /** Turns the node into a radial bar. The [member texture_progress] fills counterclockwise. See [member radial_center_offset], [member radial_initial_angle] and [member radial_fill_degrees] to control the way the bar fills up. */
            FILL_COUNTER_CLOCKWISE = 5,
            
            /** The [member texture_progress] fills from the center, expanding both towards the left and the right. */
            FILL_BILINEAR_LEFT_AND_RIGHT = 6,
            
            /** The [member texture_progress] fills from the center, expanding both towards the top and the bottom. */
            FILL_BILINEAR_TOP_AND_BOTTOM = 7,
            
            /** Turns the node into a radial bar. The [member texture_progress] fills radially from the center, expanding both clockwise and counterclockwise. See [member radial_center_offset], [member radial_initial_angle] and [member radial_fill_degrees] to control the way the bar fills up. */
            FILL_CLOCKWISE_AND_COUNTER_CLOCKWISE = 8,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureProgressBar extends __NameMapRange {
    }
    /** Texture-based progress bar. Useful for loading screens and life or stamina bars.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_textureprogressbar.html  
     */
    class TextureProgressBar<Map extends NodePathMap = any> extends Range<Map> {
        constructor(identifier?: any)
        /** Sets the stretch margin with the specified index. See [member stretch_margin_bottom] and related properties. */
        set_stretch_margin(margin: Side, value: int64): void
        
        /** Returns the stretch margin with the specified index. See [member stretch_margin_bottom] and related properties. */
        get_stretch_margin(margin: Side): int64
        
        /** The fill direction. See [enum FillMode] for possible values. */
        get fill_mode(): int64
        set fill_mode(value: int64)
        
        /** Starting angle for the fill of [member texture_progress] if [member fill_mode] is [constant FILL_CLOCKWISE], [constant FILL_COUNTER_CLOCKWISE], or [constant FILL_CLOCKWISE_AND_COUNTER_CLOCKWISE]. When the node's `value` is equal to its `min_value`, the texture doesn't show up at all. When the `value` increases, the texture fills and tends towards [member radial_fill_degrees].  
         *      
         *  **Note:** [member radial_initial_angle] is wrapped between `0` and `360` degrees (inclusive).  
         */
        get radial_initial_angle(): float64
        set radial_initial_angle(value: float64)
        
        /** Upper limit for the fill of [member texture_progress] if [member fill_mode] is [constant FILL_CLOCKWISE], [constant FILL_COUNTER_CLOCKWISE], or [constant FILL_CLOCKWISE_AND_COUNTER_CLOCKWISE]. When the node's `value` is equal to its `max_value`, the texture fills up to this angle.  
         *  See [member Range.value], [member Range.max_value].  
         */
        get radial_fill_degrees(): float64
        set radial_fill_degrees(value: float64)
        
        /** Offsets [member texture_progress] if [member fill_mode] is [constant FILL_CLOCKWISE], [constant FILL_COUNTER_CLOCKWISE], or [constant FILL_CLOCKWISE_AND_COUNTER_CLOCKWISE].  
         *      
         *  **Note:** The effective radial center always stays within the [member texture_progress] bounds. If you need to move it outside the texture's bounds, modify the [member texture_progress] to contain additional empty space where needed.  
         */
        get radial_center_offset(): Vector2
        set radial_center_offset(value: Vector2)
        
        /** If `true`, Godot treats the bar's textures like in [NinePatchRect]. Use the `stretch_margin_*` properties like [member stretch_margin_bottom] to set up the nine patch's 3×3 grid. When using a radial [member fill_mode], this setting will only enable stretching for [member texture_progress], while [member texture_under] and [member texture_over] will be treated like in [NinePatchRect]. */
        get nine_patch_stretch(): boolean
        set nine_patch_stretch(value: boolean)
        
        /** The width of the 9-patch's left column. Only effective if [member nine_patch_stretch] is `true`. */
        get stretch_margin_left(): int64
        set stretch_margin_left(value: int64)
        
        /** The height of the 9-patch's top row. Only effective if [member nine_patch_stretch] is `true`. */
        get stretch_margin_top(): int64
        set stretch_margin_top(value: int64)
        
        /** The width of the 9-patch's right column. Only effective if [member nine_patch_stretch] is `true`. */
        get stretch_margin_right(): int64
        set stretch_margin_right(value: int64)
        
        /** The height of the 9-patch's bottom row. A margin of 16 means the 9-slice's bottom corners and side will have a height of 16 pixels. You can set all 4 margin values individually to create panels with non-uniform borders. Only effective if [member nine_patch_stretch] is `true`. */
        get stretch_margin_bottom(): int64
        set stretch_margin_bottom(value: int64)
        
        /** [Texture2D] that draws under the progress bar. The bar's background. */
        get texture_under(): null | Texture2D
        set texture_under(value: null | Texture2D)
        
        /** [Texture2D] that draws over the progress bar. Use it to add highlights or an upper-frame that hides part of [member texture_progress]. */
        get texture_over(): null | Texture2D
        set texture_over(value: null | Texture2D)
        
        /** [Texture2D] that clips based on the node's `value` and [member fill_mode]. As `value` increased, the texture fills up. It shows entirely when `value` reaches `max_value`. It doesn't show at all if `value` is equal to `min_value`.  
         *  The `value` property comes from [Range]. See [member Range.value], [member Range.min_value], [member Range.max_value].  
         */
        get texture_progress(): null | Texture2D
        set texture_progress(value: null | Texture2D)
        
        /** The offset of [member texture_progress]. Useful for [member texture_over] and [member texture_under] with fancy borders, to avoid transparent margins in your progress texture. */
        get texture_progress_offset(): Vector2
        set texture_progress_offset(value: Vector2)
        
        /** Multiplies the color of the bar's [member texture_under] texture. */
        get tint_under(): Color
        set tint_under(value: Color)
        
        /** Multiplies the color of the bar's [member texture_over] texture. The effect is similar to [member CanvasItem.modulate], except it only affects this specific texture instead of the entire node. */
        get tint_over(): Color
        set tint_over(value: Color)
        
        /** Multiplies the color of the bar's [member texture_progress] texture. */
        get tint_progress(): Color
        set tint_progress(value: Color)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureProgressBar;
    }
    namespace TextureRect {
        enum ExpandMode {
            /** The minimum size will be equal to texture size, i.e. [TextureRect] can't be smaller than the texture. */
            EXPAND_KEEP_SIZE = 0,
            
            /** The size of the texture won't be considered for minimum size calculation, so the [TextureRect] can be shrunk down past the texture size. */
            EXPAND_IGNORE_SIZE = 1,
            
            /** The height of the texture will be ignored. Minimum width will be equal to the current height. Useful for horizontal layouts, e.g. inside [HBoxContainer]. */
            EXPAND_FIT_WIDTH = 2,
            
            /** Same as [constant EXPAND_FIT_WIDTH], but keeps texture's aspect ratio. */
            EXPAND_FIT_WIDTH_PROPORTIONAL = 3,
            
            /** The width of the texture will be ignored. Minimum height will be equal to the current width. Useful for vertical layouts, e.g. inside [VBoxContainer]. */
            EXPAND_FIT_HEIGHT = 4,
            
            /** Same as [constant EXPAND_FIT_HEIGHT], but keeps texture's aspect ratio. */
            EXPAND_FIT_HEIGHT_PROPORTIONAL = 5,
        }
        enum StretchMode {
            /** Scale to fit the node's bounding rectangle. */
            STRETCH_SCALE = 0,
            
            /** Tile inside the node's bounding rectangle. */
            STRETCH_TILE = 1,
            
            /** The texture keeps its original size and stays in the bounding rectangle's top-left corner. */
            STRETCH_KEEP = 2,
            
            /** The texture keeps its original size and stays centered in the node's bounding rectangle. */
            STRETCH_KEEP_CENTERED = 3,
            
            /** Scale the texture to fit the node's bounding rectangle, but maintain the texture's aspect ratio. */
            STRETCH_KEEP_ASPECT = 4,
            
            /** Scale the texture to fit the node's bounding rectangle, center it and maintain its aspect ratio. */
            STRETCH_KEEP_ASPECT_CENTERED = 5,
            
            /** Scale the texture so that the shorter side fits the bounding rectangle. The other side clips to the node's limits. */
            STRETCH_KEEP_ASPECT_COVERED = 6,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTextureRect extends __NameMapControl {
    }
    /** A control that displays a texture.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_texturerect.html  
     */
    class TextureRect<Map extends NodePathMap = any> extends Control<Map> {
        constructor(identifier?: any)
        /** The node's [Texture2D] resource. */
        get texture(): null | Texture2D
        set texture(value: null | Texture2D)
        
        /** Defines how minimum size is determined based on the texture's size. */
        get expand_mode(): int64
        set expand_mode(value: int64)
        
        /** Controls the texture's behavior when resizing the node's bounding rectangle. */
        get stretch_mode(): int64
        set stretch_mode(value: int64)
        
        /** If `true`, texture is flipped horizontally. */
        get flip_h(): boolean
        set flip_h(value: boolean)
        
        /** If `true`, texture is flipped vertically. */
        get flip_v(): boolean
        set flip_v(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTextureRect;
    }
    namespace Theme {
        enum DataType {
            /** Theme's [Color] item type. */
            DATA_TYPE_COLOR = 0,
            
            /** Theme's constant item type. */
            DATA_TYPE_CONSTANT = 1,
            
            /** Theme's [Font] item type. */
            DATA_TYPE_FONT = 2,
            
            /** Theme's font size item type. */
            DATA_TYPE_FONT_SIZE = 3,
            
            /** Theme's icon [Texture2D] item type. */
            DATA_TYPE_ICON = 4,
            
            /** Theme's [StyleBox] item type. */
            DATA_TYPE_STYLEBOX = 5,
            
            /** Maximum value for the DataType enum. */
            DATA_TYPE_MAX = 6,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTheme extends __NameMapResource {
    }
    /** A resource used for styling/skinning [Control]s and [Window]s.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_theme.html  
     */
    class Theme extends Resource {
        constructor(identifier?: any)
        /** Creates or changes the value of the icon property defined by [param name] and [param theme_type]. Use [method clear_icon] to remove the property. */
        set_icon(name: StringName, theme_type: StringName, texture: Texture2D): void
        
        /** Returns the icon property defined by [param name] and [param theme_type], if it exists.  
         *  Returns the engine fallback icon value if the property doesn't exist (see [member ThemeDB.fallback_icon]). Use [method has_icon] to check for existence.  
         */
        get_icon(name: StringName, theme_type: StringName): null | Texture2D
        
        /** Returns `true` if the icon property defined by [param name] and [param theme_type] exists.  
         *  Returns `false` if it doesn't exist. Use [method set_icon] to define it.  
         */
        has_icon(name: StringName, theme_type: StringName): boolean
        
        /** Renames the icon property defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_icon] to check for existence, and [method clear_icon] to remove the existing property.  
         */
        rename_icon(old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the icon property defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_icon] to check for existence.  
         */
        clear_icon(name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for icon properties defined with [param theme_type]. Use [method get_icon_type_list] to get a list of possible theme type names. */
        get_icon_list(theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for icon properties. Use [method get_type_list] to get a list of all unique theme types. */
        get_icon_type_list(): PackedStringArray
        
        /** Creates or changes the value of the [StyleBox] property defined by [param name] and [param theme_type]. Use [method clear_stylebox] to remove the property. */
        set_stylebox(name: StringName, theme_type: StringName, texture: StyleBox): void
        
        /** Returns the [StyleBox] property defined by [param name] and [param theme_type], if it exists.  
         *  Returns the engine fallback stylebox value if the property doesn't exist (see [member ThemeDB.fallback_stylebox]). Use [method has_stylebox] to check for existence.  
         */
        get_stylebox(name: StringName, theme_type: StringName): null | StyleBox
        
        /** Returns `true` if the [StyleBox] property defined by [param name] and [param theme_type] exists.  
         *  Returns `false` if it doesn't exist. Use [method set_stylebox] to define it.  
         */
        has_stylebox(name: StringName, theme_type: StringName): boolean
        
        /** Renames the [StyleBox] property defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_stylebox] to check for existence, and [method clear_stylebox] to remove the existing property.  
         */
        rename_stylebox(old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the [StyleBox] property defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_stylebox] to check for existence.  
         */
        clear_stylebox(name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for [StyleBox] properties defined with [param theme_type]. Use [method get_stylebox_type_list] to get a list of possible theme type names. */
        get_stylebox_list(theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for [StyleBox] properties. Use [method get_type_list] to get a list of all unique theme types. */
        get_stylebox_type_list(): PackedStringArray
        
        /** Creates or changes the value of the [Font] property defined by [param name] and [param theme_type]. Use [method clear_font] to remove the property. */
        set_font(name: StringName, theme_type: StringName, font: Font): void
        
        /** Returns the [Font] property defined by [param name] and [param theme_type], if it exists.  
         *  Returns the default theme font if the property doesn't exist and the default theme font is set up (see [member default_font]). Use [method has_font] to check for existence of the property and [method has_default_font] to check for existence of the default theme font.  
         *  Returns the engine fallback font value, if neither exist (see [member ThemeDB.fallback_font]).  
         */
        get_font(name: StringName, theme_type: StringName): null | Font
        
        /** Returns `true` if the [Font] property defined by [param name] and [param theme_type] exists, or if the default theme font is set up (see [method has_default_font]).  
         *  Returns `false` if neither exist. Use [method set_font] to define the property.  
         */
        has_font(name: StringName, theme_type: StringName): boolean
        
        /** Renames the [Font] property defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_font] to check for existence, and [method clear_font] to remove the existing property.  
         */
        rename_font(old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the [Font] property defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_font] to check for existence.  
         */
        clear_font(name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for [Font] properties defined with [param theme_type]. Use [method get_font_type_list] to get a list of possible theme type names. */
        get_font_list(theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for [Font] properties. Use [method get_type_list] to get a list of all unique theme types. */
        get_font_type_list(): PackedStringArray
        
        /** Creates or changes the value of the font size property defined by [param name] and [param theme_type]. Use [method clear_font_size] to remove the property. */
        set_font_size(name: StringName, theme_type: StringName, font_size: int64): void
        
        /** Returns the font size property defined by [param name] and [param theme_type], if it exists.  
         *  Returns the default theme font size if the property doesn't exist and the default theme font size is set up (see [member default_font_size]). Use [method has_font_size] to check for existence of the property and [method has_default_font_size] to check for existence of the default theme font.  
         *  Returns the engine fallback font size value, if neither exist (see [member ThemeDB.fallback_font_size]).  
         */
        get_font_size(name: StringName, theme_type: StringName): int64
        
        /** Returns `true` if the font size property defined by [param name] and [param theme_type] exists, or if the default theme font size is set up (see [method has_default_font_size]).  
         *  Returns `false` if neither exist. Use [method set_font_size] to define the property.  
         */
        has_font_size(name: StringName, theme_type: StringName): boolean
        
        /** Renames the font size property defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_font_size] to check for existence, and [method clear_font_size] to remove the existing property.  
         */
        rename_font_size(old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the font size property defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_font_size] to check for existence.  
         */
        clear_font_size(name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for font size properties defined with [param theme_type]. Use [method get_font_size_type_list] to get a list of possible theme type names. */
        get_font_size_list(theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for font size properties. Use [method get_type_list] to get a list of all unique theme types. */
        get_font_size_type_list(): PackedStringArray
        
        /** Creates or changes the value of the [Color] property defined by [param name] and [param theme_type]. Use [method clear_color] to remove the property. */
        set_color(name: StringName, theme_type: StringName, color: Color): void
        
        /** Returns the [Color] property defined by [param name] and [param theme_type], if it exists.  
         *  Returns the default color value if the property doesn't exist. Use [method has_color] to check for existence.  
         */
        get_color(name: StringName, theme_type: StringName): Color
        
        /** Returns `true` if the [Color] property defined by [param name] and [param theme_type] exists.  
         *  Returns `false` if it doesn't exist. Use [method set_color] to define it.  
         */
        has_color(name: StringName, theme_type: StringName): boolean
        
        /** Renames the [Color] property defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_color] to check for existence, and [method clear_color] to remove the existing property.  
         */
        rename_color(old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the [Color] property defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_color] to check for existence.  
         */
        clear_color(name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for [Color] properties defined with [param theme_type]. Use [method get_color_type_list] to get a list of possible theme type names. */
        get_color_list(theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for [Color] properties. Use [method get_type_list] to get a list of all unique theme types. */
        get_color_type_list(): PackedStringArray
        
        /** Creates or changes the value of the constant property defined by [param name] and [param theme_type]. Use [method clear_constant] to remove the property. */
        set_constant(name: StringName, theme_type: StringName, constant: int64): void
        
        /** Returns the constant property defined by [param name] and [param theme_type], if it exists.  
         *  Returns `0` if the property doesn't exist. Use [method has_constant] to check for existence.  
         */
        get_constant(name: StringName, theme_type: StringName): int64
        
        /** Returns `true` if the constant property defined by [param name] and [param theme_type] exists.  
         *  Returns `false` if it doesn't exist. Use [method set_constant] to define it.  
         */
        has_constant(name: StringName, theme_type: StringName): boolean
        
        /** Renames the constant property defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_constant] to check for existence, and [method clear_constant] to remove the existing property.  
         */
        rename_constant(old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the constant property defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_constant] to check for existence.  
         */
        clear_constant(name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for constant properties defined with [param theme_type]. Use [method get_constant_type_list] to get a list of possible theme type names. */
        get_constant_list(theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for constant properties. Use [method get_type_list] to get a list of all unique theme types. */
        get_constant_type_list(): PackedStringArray
        
        /** Returns `true` if [member default_base_scale] has a valid value.  
         *  Returns `false` if it doesn't. The value must be greater than `0.0` to be considered valid.  
         */
        has_default_base_scale(): boolean
        
        /** Returns `true` if [member default_font] has a valid value.  
         *  Returns `false` if it doesn't.  
         */
        has_default_font(): boolean
        
        /** Returns `true` if [member default_font_size] has a valid value.  
         *  Returns `false` if it doesn't. The value must be greater than `0` to be considered valid.  
         */
        has_default_font_size(): boolean
        
        /** Creates or changes the value of the theme property of [param data_type] defined by [param name] and [param theme_type]. Use [method clear_theme_item] to remove the property.  
         *  Fails if the [param value] type is not accepted by [param data_type].  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        set_theme_item(data_type: Theme.DataType, name: StringName, theme_type: StringName, value: any): void
        
        /** Returns the theme property of [param data_type] defined by [param name] and [param theme_type], if it exists.  
         *  Returns the engine fallback value if the property doesn't exist (see [ThemeDB]). Use [method has_theme_item] to check for existence.  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        get_theme_item(data_type: Theme.DataType, name: StringName, theme_type: StringName): any
        
        /** Returns `true` if the theme property of [param data_type] defined by [param name] and [param theme_type] exists.  
         *  Returns `false` if it doesn't exist. Use [method set_theme_item] to define it.  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        has_theme_item(data_type: Theme.DataType, name: StringName, theme_type: StringName): boolean
        
        /** Renames the theme property of [param data_type] defined by [param old_name] and [param theme_type] to [param name], if it exists.  
         *  Fails if it doesn't exist, or if a similar property with the new name already exists. Use [method has_theme_item] to check for existence, and [method clear_theme_item] to remove the existing property.  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        rename_theme_item(data_type: Theme.DataType, old_name: StringName, name: StringName, theme_type: StringName): void
        
        /** Removes the theme property of [param data_type] defined by [param name] and [param theme_type], if it exists.  
         *  Fails if it doesn't exist. Use [method has_theme_item] to check for existence.  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        clear_theme_item(data_type: Theme.DataType, name: StringName, theme_type: StringName): void
        
        /** Returns a list of names for properties of [param data_type] defined with [param theme_type]. Use [method get_theme_item_type_list] to get a list of possible theme type names.  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        get_theme_item_list(data_type: Theme.DataType, theme_type: string): PackedStringArray
        
        /** Returns a list of all unique theme type names for [param data_type] properties. Use [method get_type_list] to get a list of all unique theme types.  
         *      
         *  **Note:** This method is analogous to calling the corresponding data type specific method, but can be used for more generalized logic.  
         */
        get_theme_item_type_list(data_type: Theme.DataType): PackedStringArray
        
        /** Marks [param theme_type] as a variation of [param base_type].  
         *  This adds [param theme_type] as a suggested option for [member Control.theme_type_variation] on a [Control] that is of the [param base_type] class.  
         *  Variations can also be nested, i.e. [param base_type] can be another variation. If a chain of variations ends with a [param base_type] matching the class of the [Control], the whole chain is going to be suggested as options.  
         *      
         *  **Note:** Suggestions only show up if this theme resource is set as the project default theme. See [member ProjectSettings.gui/theme/custom].  
         */
        set_type_variation(theme_type: StringName, base_type: StringName): void
        
        /** Returns `true` if [param theme_type] is marked as a variation of [param base_type]. */
        is_type_variation(theme_type: StringName, base_type: StringName): boolean
        
        /** Unmarks [param theme_type] as being a variation of another theme type. See [method set_type_variation]. */
        clear_type_variation(theme_type: StringName): void
        
        /** Returns the name of the base theme type if [param theme_type] is a valid variation type. Returns an empty string otherwise. */
        get_type_variation_base(theme_type: StringName): StringName
        
        /** Returns a list of all type variations for the given [param base_type]. */
        get_type_variation_list(base_type: StringName): PackedStringArray
        
        /** Adds an empty theme type for every valid data type.  
         *      
         *  **Note:** Empty types are not saved with the theme. This method only exists to perform in-memory changes to the resource. Use available `set_*` methods to add theme items.  
         */
        add_type(theme_type: StringName): void
        
        /** Removes the theme type, gracefully discarding defined theme items. If the type is a variation, this information is also erased. If the type is a base for type variations, those variations lose their base. */
        remove_type(theme_type: StringName): void
        
        /** Renames the theme type [param old_theme_type] to [param theme_type], if the old type exists and the new one doesn't exist.  
         *      
         *  **Note:** Renaming a theme type to an empty name or a variation to a type associated with a built-in class removes type variation connections in a way that cannot be undone by reversing the rename alone.  
         */
        rename_type(old_theme_type: StringName, theme_type: StringName): void
        
        /** Returns a list of all unique theme type names. Use the appropriate `get_*_type_list` method to get a list of unique theme types for a single data type. */
        get_type_list(): PackedStringArray
        
        /** Adds missing and overrides existing definitions with values from the [param other] theme resource.  
         *      
         *  **Note:** This modifies the current theme. If you want to merge two themes together without modifying either one, create a new empty theme and merge the other two into it one after another.  
         */
        merge_with(other: Theme): void
        
        /** Removes all the theme properties defined on the theme resource. */
        clear(): void
        
        /** The default base scale factor of this theme resource. Used by some controls to scale their visual properties based on the global scale factor. If this value is set to `0.0`, the global scale factor is used (see [member ThemeDB.fallback_base_scale]).  
         *  Use [method has_default_base_scale] to check if this value is valid.  
         */
        get default_base_scale(): float64
        set default_base_scale(value: float64)
        
        /** The default font of this theme resource. Used as the default value when trying to fetch a font resource that doesn't exist in this theme or is in invalid state. If the default font is also missing or invalid, the engine fallback value is used (see [member ThemeDB.fallback_font]).  
         *  Use [method has_default_font] to check if this value is valid.  
         */
        get default_font(): null | Font
        set default_font(value: null | Font)
        
        /** The default font size of this theme resource. Used as the default value when trying to fetch a font size value that doesn't exist in this theme or is in invalid state. If the default font size is also missing or invalid, the engine fallback value is used (see [member ThemeDB.fallback_font_size]).  
         *  Values below `1` are invalid and can be used to unset the property. Use [method has_default_font_size] to check if this value is valid.  
         */
        get default_font_size(): int64
        set default_font_size(value: int64)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTheme;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTileData extends __NameMapObject {
    }
    /** Settings for a single tile in a [TileSet].  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tiledata.html  
     */
    class TileData extends Object {
        constructor(identifier?: any)
        /** Sets the occluder polygon count in the TileSet occlusion layer with index [param layer_id]. */
        set_occluder_polygons_count(layer_id: int64, polygons_count: int64): void
        
        /** Returns the number of occluder polygons of the tile in the TileSet occlusion layer with index [param layer_id]. */
        get_occluder_polygons_count(layer_id: int64): int64
        
        /** Adds an occlusion polygon to the tile on the TileSet occlusion layer with index [param layer_id]. */
        add_occluder_polygon(layer_id: int64): void
        
        /** Removes the polygon at index [param polygon_index] for TileSet occlusion layer with index [param layer_id]. */
        remove_occluder_polygon(layer_id: int64, polygon_index: int64): void
        
        /** Sets the occluder for polygon with index [param polygon_index] in the TileSet occlusion layer with index [param layer_id]. */
        set_occluder_polygon(layer_id: int64, polygon_index: int64, polygon: OccluderPolygon2D): void
        
        /** Returns the occluder polygon at index [param polygon_index] from the TileSet occlusion layer with index [param layer_id].  
         *  The [param flip_h], [param flip_v], and [param transpose] parameters can be `true` to transform the returned polygon.  
         */
        get_occluder_polygon(layer_id: int64, polygon_index: int64, flip_h?: boolean /* = false */, flip_v?: boolean /* = false */, transpose?: boolean /* = false */): null | OccluderPolygon2D
        
        /** Sets the occluder for the TileSet occlusion layer with index [param layer_id]. */
        set_occluder(layer_id: int64, occluder_polygon: OccluderPolygon2D): void
        
        /** Returns the occluder polygon of the tile for the TileSet occlusion layer with index [param layer_id].  
         *  [param flip_h], [param flip_v], and [param transpose] allow transforming the returned polygon.  
         */
        get_occluder(layer_id: int64, flip_h?: boolean /* = false */, flip_v?: boolean /* = false */, transpose?: boolean /* = false */): null | OccluderPolygon2D
        
        /** Sets the constant linear velocity. This does not move the tile. This linear velocity is applied to objects colliding with this tile. This is useful to create conveyor belts. */
        set_constant_linear_velocity(layer_id: int64, velocity: Vector2): void
        
        /** Returns the constant linear velocity applied to objects colliding with this tile. */
        get_constant_linear_velocity(layer_id: int64): Vector2
        
        /** Sets the constant angular velocity. This does not rotate the tile. This angular velocity is applied to objects colliding with this tile. */
        set_constant_angular_velocity(layer_id: int64, velocity: float64): void
        
        /** Returns the constant angular velocity applied to objects colliding with this tile. */
        get_constant_angular_velocity(layer_id: int64): float64
        
        /** Sets the polygons count for TileSet physics layer with index [param layer_id]. */
        set_collision_polygons_count(layer_id: int64, polygons_count: int64): void
        
        /** Returns how many polygons the tile has for TileSet physics layer with index [param layer_id]. */
        get_collision_polygons_count(layer_id: int64): int64
        
        /** Adds a collision polygon to the tile on the given TileSet physics layer. */
        add_collision_polygon(layer_id: int64): void
        
        /** Removes the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        remove_collision_polygon(layer_id: int64, polygon_index: int64): void
        
        /** Sets the points of the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        set_collision_polygon_points(layer_id: int64, polygon_index: int64, polygon: PackedVector2Array | Vector2[]): void
        
        /** Returns the points of the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        get_collision_polygon_points(layer_id: int64, polygon_index: int64): PackedVector2Array
        
        /** Enables/disables one-way collisions on the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        set_collision_polygon_one_way(layer_id: int64, polygon_index: int64, one_way: boolean): void
        
        /** Returns whether one-way collisions are enabled for the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        is_collision_polygon_one_way(layer_id: int64, polygon_index: int64): boolean
        
        /** Sets the one-way margin (for one-way platforms) of the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        set_collision_polygon_one_way_margin(layer_id: int64, polygon_index: int64, one_way_margin: float64): void
        
        /** Returns the one-way margin (for one-way platforms) of the polygon at index [param polygon_index] for TileSet physics layer with index [param layer_id]. */
        get_collision_polygon_one_way_margin(layer_id: int64, polygon_index: int64): float64
        
        /** Sets the tile's terrain bit for the given [param peering_bit] direction. To check that a direction is valid, use [method is_valid_terrain_peering_bit]. */
        set_terrain_peering_bit(peering_bit: TileSet.CellNeighbor, terrain: int64): void
        
        /** Returns the tile's terrain bit for the given [param peering_bit] direction. To check that a direction is valid, use [method is_valid_terrain_peering_bit]. */
        get_terrain_peering_bit(peering_bit: TileSet.CellNeighbor): int64
        
        /** Returns whether the given [param peering_bit] direction is valid for this tile. */
        is_valid_terrain_peering_bit(peering_bit: TileSet.CellNeighbor): boolean
        
        /** Sets the navigation polygon for the TileSet navigation layer with index [param layer_id]. */
        set_navigation_polygon(layer_id: int64, navigation_polygon: NavigationPolygon): void
        
        /** Returns the navigation polygon of the tile for the TileSet navigation layer with index [param layer_id].  
         *  [param flip_h], [param flip_v], and [param transpose] allow transforming the returned polygon.  
         */
        get_navigation_polygon(layer_id: int64, flip_h?: boolean /* = false */, flip_v?: boolean /* = false */, transpose?: boolean /* = false */): null | NavigationPolygon
        
        /** Sets the tile's custom data value for the TileSet custom data layer with name [param layer_name]. */
        set_custom_data(layer_name: string, value: any): void
        
        /** Returns the custom data value for custom data layer named [param layer_name]. To check if a custom data layer exists, use [method has_custom_data]. */
        get_custom_data(layer_name: string): any
        
        /** Returns whether there exists a custom data layer named [param layer_name]. */
        has_custom_data(layer_name: string): boolean
        
        /** Sets the tile's custom data value for the TileSet custom data layer with index [param layer_id]. */
        set_custom_data_by_layer_id(layer_id: int64, value: any): void
        
        /** Returns the custom data value for custom data layer with index [param layer_id]. */
        get_custom_data_by_layer_id(layer_id: int64): any
        
        /** If `true`, the tile will have its texture flipped horizontally. */
        get flip_h(): boolean
        set flip_h(value: boolean)
        
        /** If `true`, the tile will have its texture flipped vertically. */
        get flip_v(): boolean
        set flip_v(value: boolean)
        
        /** If `true`, the tile will display transposed, i.e. with horizontal and vertical texture UVs swapped. */
        get transpose(): boolean
        set transpose(value: boolean)
        
        /** Offsets the position of where the tile is drawn. */
        get texture_origin(): Vector2i
        set texture_origin(value: Vector2i)
        
        /** Color modulation of the tile. */
        get modulate(): Color
        set modulate(value: Color)
        
        /** The [Material] to use for this [TileData]. This can be a [CanvasItemMaterial] to use the default shader, or a [ShaderMaterial] to use a custom shader. */
        get material(): null | CanvasItemMaterial | ShaderMaterial
        set material(value: null | CanvasItemMaterial | ShaderMaterial)
        
        /** Ordering index of this tile, relative to [TileMapLayer]. */
        get z_index(): int64
        set z_index(value: int64)
        
        /** Vertical point of the tile used for determining y-sorted order. */
        get y_sort_origin(): int64
        set y_sort_origin(value: int64)
        
        /** ID of the terrain set that the tile uses. */
        get terrain_set(): int64
        set terrain_set(value: int64)
        
        /** ID of the terrain from the terrain set that the tile uses. */
        get terrain(): int64
        set terrain(value: int64)
        
        /** Relative probability of this tile being selected when drawing a pattern of random tiles. */
        get probability(): float64
        set probability(value: float64)
        
        /** Emitted when any of the properties are changed. */
        readonly changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTileData;
    }
    namespace TileMap {
        enum VisibilityMode {
            /** Use the debug settings to determine visibility. */
            VISIBILITY_MODE_DEFAULT = 0,
            
            /** Always hide. */
            VISIBILITY_MODE_FORCE_HIDE = 2,
            
            /** Always show. */
            VISIBILITY_MODE_FORCE_SHOW = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTileMap extends __NameMapNode2D {
    }
    /** Node for 2D tile-based maps.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tilemap.html  
     */
    class TileMap<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** Should return `true` if the tile at coordinates [param coords] on layer [param layer] requires a runtime update.  
         *  **Warning:** Make sure this function only return `true` when needed. Any tile processed at runtime without a need for it will imply a significant performance penalty.  
         *      
         *  **Note:** If the result of this function should changed, use [method notify_runtime_tile_data_update] to notify the TileMap it needs an update.  
         */
        /* gdvirtual */ _use_tile_data_runtime_update(layer: int64, coords: Vector2i): boolean
        
        /** Called with a TileData object about to be used internally by the TileMap, allowing its modification at runtime.  
         *  This method is only called if [method _use_tile_data_runtime_update] is implemented and returns `true` for the given tile [param coords] and [param layer].  
         *  **Warning:** The [param tile_data] object's sub-resources are the same as the one in the TileSet. Modifying them might impact the whole TileSet. Instead, make sure to duplicate those resources.  
         *      
         *  **Note:** If the properties of [param tile_data] object should change over time, use [method notify_runtime_tile_data_update] to notify the TileMap it needs an update.  
         */
        /* gdvirtual */ _tile_data_runtime_update(layer: int64, coords: Vector2i, tile_data: TileData): void
        
        /** Assigns [param map] as a [NavigationServer2D] navigation map for the specified TileMap layer [param layer]. */
        set_navigation_map(layer: int64, map: RID): void
        
        /** Returns the [RID] of the [NavigationServer2D] navigation map assigned to the specified TileMap layer [param layer]. */
        get_navigation_map(layer: int64): RID
        
        /** Forces the TileMap and the layer [param layer] to update. */
        force_update(layer?: int64 /* = -1 */): void
        
        /** Returns the number of layers in the TileMap. */
        get_layers_count(): int64
        
        /** Adds a layer at the given position [param to_position] in the array. If [param to_position] is negative, the position is counted from the end, with `-1` adding the layer at the end of the array. */
        add_layer(to_position: int64): void
        
        /** Moves the layer at index [param layer] to the given position [param to_position] in the array. */
        move_layer(layer: int64, to_position: int64): void
        
        /** Removes the layer at index [param layer]. */
        remove_layer(layer: int64): void
        
        /** Sets a layer's name. This is mostly useful in the editor.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_name(layer: int64, name: string): void
        
        /** Returns a TileMap layer's name.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_layer_name(layer: int64): string
        
        /** Enables or disables the layer [param layer]. A disabled layer is not processed at all (no rendering, no physics, etc.).  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_enabled(layer: int64, enabled: boolean): void
        
        /** Returns if a layer is enabled.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        is_layer_enabled(layer: int64): boolean
        
        /** Sets a layer's color. It will be multiplied by tile's color and TileMap's modulate.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_modulate(layer: int64, modulate: Color): void
        
        /** Returns a TileMap layer's modulate.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_layer_modulate(layer: int64): Color
        
        /** Enables or disables a layer's Y-sorting. If a layer is Y-sorted, the layer will behave as a CanvasItem node where each of its tile gets Y-sorted.  
         *  Y-sorted layers should usually be on different Z-index values than not Y-sorted layers, otherwise, each of those layer will be Y-sorted as whole with the Y-sorted one. This is usually an undesired behavior.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_y_sort_enabled(layer: int64, y_sort_enabled: boolean): void
        
        /** Returns if a layer Y-sorts its tiles.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        is_layer_y_sort_enabled(layer: int64): boolean
        
        /** Sets a layer's Y-sort origin value. This Y-sort origin value is added to each tile's Y-sort origin value.  
         *  This allows, for example, to fake a different height level on each layer. This can be useful for top-down view games.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_y_sort_origin(layer: int64, y_sort_origin: int64): void
        
        /** Returns a TileMap layer's Y sort origin.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_layer_y_sort_origin(layer: int64): int64
        
        /** Sets a layers Z-index value. This Z-index is added to each tile's Z-index value.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_z_index(layer: int64, z_index: int64): void
        
        /** Returns a TileMap layer's Z-index value.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_layer_z_index(layer: int64): int64
        
        /** Enables or disables a layer's built-in navigation regions generation. Disable this if you need to bake navigation regions from a TileMap using a [NavigationRegion2D] node. */
        set_layer_navigation_enabled(layer: int64, enabled: boolean): void
        
        /** Returns if a layer's built-in navigation regions generation is enabled. */
        is_layer_navigation_enabled(layer: int64): boolean
        
        /** Assigns [param map] as a [NavigationServer2D] navigation map for the specified TileMap layer [param layer].  
         *  By default the TileMap uses the default [World2D] navigation map for the first TileMap layer. For each additional TileMap layer a new navigation map is created for the additional layer.  
         *  In order to make [NavigationAgent2D] switch between TileMap layer navigation maps use [method NavigationAgent2D.set_navigation_map] with the navigation map received from [method get_layer_navigation_map].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_layer_navigation_map(layer: int64, map: RID): void
        
        /** Returns the [RID] of the [NavigationServer2D] navigation map assigned to the specified TileMap layer [param layer].  
         *  By default the TileMap uses the default [World2D] navigation map for the first TileMap layer. For each additional TileMap layer a new navigation map is created for the additional layer.  
         *  In order to make [NavigationAgent2D] switch between TileMap layer navigation maps use [method NavigationAgent2D.set_navigation_map] with the navigation map received from [method get_layer_navigation_map].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_layer_navigation_map(layer: int64): RID
        
        /** Sets the tile identifiers for the cell on layer [param layer] at coordinates [param coords]. Each tile of the [TileSet] is identified using three parts:  
         *  - The source identifier [param source_id] identifies a [TileSetSource] identifier. See [method TileSet.set_source_id],  
         *  - The atlas coordinates identifier [param atlas_coords] identifies a tile coordinates in the atlas (if the source is a [TileSetAtlasSource]). For [TileSetScenesCollectionSource] it should always be `Vector2i(0, 0)`),  
         *  - The alternative tile identifier [param alternative_tile] identifies a tile alternative in the atlas (if the source is a [TileSetAtlasSource]), and the scene for a [TileSetScenesCollectionSource].  
         *  If [param source_id] is set to `-1`, [param atlas_coords] to `Vector2i(-1, -1)` or [param alternative_tile] to `-1`, the cell will be erased. An erased cell gets **all** its identifiers automatically set to their respective invalid values, namely `-1`, `Vector2i(-1, -1)` and `-1`.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_cell(layer: int64, coords: Vector2i, source_id?: int64 /* = -1 */, atlas_coords?: Vector2i /* = new Vector2i(-1, -1) */, alternative_tile?: int64 /* = 0 */): void
        
        /** Erases the cell on layer [param layer] at coordinates [param coords].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        erase_cell(layer: int64, coords: Vector2i): void
        
        /** Returns the tile source ID of the cell on layer [param layer] at coordinates [param coords]. Returns `-1` if the cell does not exist.  
         *  If [param use_proxies] is `false`, ignores the [TileSet]'s tile proxies, returning the raw source identifier. See [method TileSet.map_tile_proxy].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_cell_source_id(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): int64
        
        /** Returns the tile atlas coordinates ID of the cell on layer [param layer] at coordinates [param coords]. Returns `Vector2i(-1, -1)` if the cell does not exist.  
         *  If [param use_proxies] is `false`, ignores the [TileSet]'s tile proxies, returning the raw atlas coordinate identifier. See [method TileSet.map_tile_proxy].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_cell_atlas_coords(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): Vector2i
        
        /** Returns the tile alternative ID of the cell on layer [param layer] at [param coords].  
         *  If [param use_proxies] is `false`, ignores the [TileSet]'s tile proxies, returning the raw alternative identifier. See [method TileSet.map_tile_proxy].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_cell_alternative_tile(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): int64
        
        /** Returns the [TileData] object associated with the given cell, or `null` if the cell does not exist or is not a [TileSetAtlasSource].  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         *    
         *  If [param use_proxies] is `false`, ignores the [TileSet]'s tile proxies. See [method TileSet.map_tile_proxy].  
         */
        get_cell_tile_data(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): null | TileData
        
        /** Returns `true` if the cell on layer [param layer] at coordinates [param coords] is flipped horizontally. The result is valid only for atlas sources. */
        is_cell_flipped_h(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): boolean
        
        /** Returns `true` if the cell on layer [param layer] at coordinates [param coords] is flipped vertically. The result is valid only for atlas sources. */
        is_cell_flipped_v(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): boolean
        
        /** Returns `true` if the cell on layer [param layer] at coordinates [param coords] is transposed. The result is valid only for atlas sources. */
        is_cell_transposed(layer: int64, coords: Vector2i, use_proxies?: boolean /* = false */): boolean
        
        /** Returns the coordinates of the tile for given physics body RID. Such RID can be retrieved from [method KinematicCollision2D.get_collider_rid], when colliding with a tile. */
        get_coords_for_body_rid(body: RID): Vector2i
        
        /** Returns the tilemap layer of the tile for given physics body RID. Such RID can be retrieved from [method KinematicCollision2D.get_collider_rid], when colliding with a tile. */
        get_layer_for_body_rid(body: RID): int64
        
        /** Creates a new [TileMapPattern] from the given layer and set of cells.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_pattern(layer: int64, coords_array: GArray<Vector2i>): null | TileMapPattern
        
        /** Returns for the given coordinate [param coords_in_pattern] in a [TileMapPattern] the corresponding cell coordinates if the pattern was pasted at the [param position_in_tilemap] coordinates (see [method set_pattern]). This mapping is required as in half-offset tile shapes, the mapping might not work by calculating `position_in_tile_map + coords_in_pattern`. */
        map_pattern(position_in_tilemap: Vector2i, coords_in_pattern: Vector2i, pattern: TileMapPattern): Vector2i
        
        /** Paste the given [TileMapPattern] at the given [param position] and [param layer] in the tile map.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        set_pattern(layer: int64, position: Vector2i, pattern: TileMapPattern): void
        
        /** Update all the cells in the [param cells] coordinates array so that they use the given [param terrain] for the given [param terrain_set]. If an updated cell has the same terrain as one of its neighboring cells, this function tries to join the two. This function might update neighboring tiles if needed to create correct terrain transitions.  
         *  If [param ignore_empty_terrains] is `true`, empty terrains will be ignored when trying to find the best fitting tile for the given terrain constraints.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         *      
         *  **Note:** To work correctly, this method requires the TileMap's TileSet to have terrains set up with all required terrain combinations. Otherwise, it may produce unexpected results.  
         */
        set_cells_terrain_connect(layer: int64, cells: GArray<Vector2i>, terrain_set: int64, terrain: int64, ignore_empty_terrains?: boolean /* = true */): void
        
        /** Update all the cells in the [param path] coordinates array so that they use the given [param terrain] for the given [param terrain_set]. The function will also connect two successive cell in the path with the same terrain. This function might update neighboring tiles if needed to create correct terrain transitions.  
         *  If [param ignore_empty_terrains] is `true`, empty terrains will be ignored when trying to find the best fitting tile for the given terrain constraints.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         *      
         *  **Note:** To work correctly, this method requires the TileMap's TileSet to have terrains set up with all required terrain combinations. Otherwise, it may produce unexpected results.  
         */
        set_cells_terrain_path(layer: int64, path: GArray<Vector2i>, terrain_set: int64, terrain: int64, ignore_empty_terrains?: boolean /* = true */): void
        
        /** Clears cells that do not exist in the tileset. */
        fix_invalid_tiles(): void
        
        /** Clears all cells on the given layer.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        clear_layer(layer: int64): void
        
        /** Clears all cells. */
        clear(): void
        
        /** Triggers a direct update of the TileMap. Usually, calling this function is not needed, as TileMap node updates automatically when one of its properties or cells is modified.  
         *  However, for performance reasons, those updates are batched and delayed to the end of the frame. Calling this function will force the TileMap to update right away instead.  
         *  **Warning:** Updating the TileMap is computationally expensive and may impact performance. Try to limit the number of updates and how many tiles they impact.  
         */
        update_internals(): void
        
        /** Notifies the TileMap node that calls to [method _use_tile_data_runtime_update] or [method _tile_data_runtime_update] will lead to different results. This will thus trigger a TileMap update.  
         *  If [param layer] is provided, only notifies changes for the given layer. Providing the [param layer] argument (when applicable) is usually preferred for performance reasons.  
         *  **Warning:** Updating the TileMap is computationally expensive and may impact performance. Try to limit the number of calls to this function to avoid unnecessary update.  
         *      
         *  **Note:** This does not trigger a direct update of the TileMap, the update will be done at the end of the frame as usual (unless you call [method update_internals]).  
         */
        notify_runtime_tile_data_update(layer?: int64 /* = -1 */): void
        
        /** Returns the list of all neighbourings cells to the one at [param coords]. */
        get_surrounding_cells(coords: Vector2i): GArray<Vector2i>
        
        /** Returns a [Vector2i] array with the positions of all cells containing a tile in the given layer. A cell is considered empty if its source identifier equals -1, its atlas coordinates identifiers is `Vector2(-1, -1)` and its alternative identifier is -1.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_used_cells(layer: int64): GArray<Vector2i>
        
        /** Returns a [Vector2i] array with the positions of all cells containing a tile in the given layer. Tiles may be filtered according to their source ([param source_id]), their atlas coordinates ([param atlas_coords]) or alternative id ([param alternative_tile]).  
         *  If a parameter has its value set to the default one, this parameter is not used to filter a cell. Thus, if all parameters have their respective default value, this method returns the same result as [method get_used_cells].  
         *  A cell is considered empty if its source identifier equals -1, its atlas coordinates identifiers is `Vector2(-1, -1)` and its alternative identifier is -1.  
         *  If [param layer] is negative, the layers are accessed from the last one.  
         */
        get_used_cells_by_id(layer: int64, source_id?: int64 /* = -1 */, atlas_coords?: Vector2i /* = new Vector2i(-1, -1) */, alternative_tile?: int64 /* = -1 */): GArray<Vector2i>
        
        /** Returns a rectangle enclosing the used (non-empty) tiles of the map, including all layers. */
        get_used_rect(): Rect2i
        
        /** Returns the centered position of a cell in the TileMap's local coordinate space. To convert the returned value into global coordinates, use [method Node2D.to_global]. See also [method local_to_map].  
         *      
         *  **Note:** This may not correspond to the visual position of the tile, i.e. it ignores the [member TileData.texture_origin] property of individual tiles.  
         */
        map_to_local(map_position: Vector2i): Vector2
        
        /** Returns the map coordinates of the cell containing the given [param local_position]. If [param local_position] is in global coordinates, consider using [method Node2D.to_local] before passing it to this method. See also [method map_to_local]. */
        local_to_map(local_position: Vector2): Vector2i
        
        /** Returns the neighboring cell to the one at coordinates [param coords], identified by the [param neighbor] direction. This method takes into account the different layouts a TileMap can take. */
        get_neighbor_cell(coords: Vector2i, neighbor: TileSet.CellNeighbor): Vector2i
        
        /** The [TileSet] used by this [TileMap]. The textures, collisions, and additional behavior of all available tiles are stored here. */
        get tile_set(): null | TileSet
        set tile_set(value: null | TileSet)
        
        /** The TileMap's quadrant size. A quadrant is a group of tiles to be drawn together on a single canvas item, for optimization purposes. [member rendering_quadrant_size] defines the length of a square's side, in the map's coordinate system, that forms the quadrant. Thus, the default quadrant size groups together `16 * 16 = 256` tiles.  
         *  The quadrant size does not apply on Y-sorted layers, as tiles are grouped by Y position instead in that case.  
         *      
         *  **Note:** As quadrants are created according to the map's coordinate system, the quadrant's "square shape" might not look like square in the TileMap's local coordinate system.  
         */
        get rendering_quadrant_size(): int64
        set rendering_quadrant_size(value: int64)
        
        /** If enabled, the TileMap will see its collisions synced to the physics tick and change its collision type from static to kinematic. This is required to create TileMap-based moving platform.  
         *      
         *  **Note:** Enabling [member collision_animatable] may have a small performance impact, only do it if the TileMap is moving and has colliding tiles.  
         */
        get collision_animatable(): boolean
        set collision_animatable(value: boolean)
        
        /** Show or hide the TileMap's collision shapes. If set to [constant VISIBILITY_MODE_DEFAULT], this depends on the show collision debug settings. */
        get collision_visibility_mode(): int64
        set collision_visibility_mode(value: int64)
        
        /** Show or hide the TileMap's navigation meshes. If set to [constant VISIBILITY_MODE_DEFAULT], this depends on the show navigation debug settings. */
        get navigation_visibility_mode(): int64
        set navigation_visibility_mode(value: int64)
        
        /** Emitted when the [TileSet] of this TileMap changes. */
        readonly changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTileMap;
    }
    namespace TileMapLayer {
        enum DebugVisibilityMode {
            /** Hide the collisions or navigation debug shapes in the editor, and use the debug settings to determine their visibility in game (i.e. [member SceneTree.debug_collisions_hint] or [member SceneTree.debug_navigation_hint]). */
            DEBUG_VISIBILITY_MODE_DEFAULT = 0,
            
            /** Always hide the collisions or navigation debug shapes. */
            DEBUG_VISIBILITY_MODE_FORCE_HIDE = 2,
            
            /** Always show the collisions or navigation debug shapes. */
            DEBUG_VISIBILITY_MODE_FORCE_SHOW = 1,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTileMapLayer extends __NameMapNode2D {
    }
    /** Node for 2D tile-based maps.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tilemaplayer.html  
     */
    class TileMapLayer<Map extends NodePathMap = any> extends Node2D<Map> {
        constructor(identifier?: any)
        /** Should return `true` if the tile at coordinates [param coords] requires a runtime update.  
         *  **Warning:** Make sure this function only returns `true` when needed. Any tile processed at runtime without a need for it will imply a significant performance penalty.  
         *      
         *  **Note:** If the result of this function should change, use [method notify_runtime_tile_data_update] to notify the [TileMapLayer] it needs an update.  
         */
        /* gdvirtual */ _use_tile_data_runtime_update(coords: Vector2i): boolean
        
        /** Called with a [TileData] object about to be used internally by the [TileMapLayer], allowing its modification at runtime.  
         *  This method is only called if [method _use_tile_data_runtime_update] is implemented and returns `true` for the given tile [param coords].  
         *  **Warning:** The [param tile_data] object's sub-resources are the same as the one in the TileSet. Modifying them might impact the whole TileSet. Instead, make sure to duplicate those resources.  
         *      
         *  **Note:** If the properties of [param tile_data] object should change over time, use [method notify_runtime_tile_data_update] to notify the [TileMapLayer] it needs an update.  
         */
        /* gdvirtual */ _tile_data_runtime_update(coords: Vector2i, tile_data: TileData): void
        
        /** Called when this [TileMapLayer]'s cells need an internal update. This update may be caused from individual cells being modified or by a change in the [member tile_set] (causing all cells to be queued for an update). The first call to this function is always for initializing all the [TileMapLayer]'s cells. [param coords] contains the coordinates of all modified cells, roughly in the order they were modified. [param forced_cleanup] is `true` when the [TileMapLayer]'s internals should be fully cleaned up. This is the case when:  
         *  - The layer is disabled;  
         *  - The layer is not visible;  
         *  - [member tile_set] is set to `null`;  
         *  - The node is removed from the tree;  
         *  - The node is freed.  
         *  Note that any internal update happening while one of these conditions is verified is considered to be a "cleanup". See also [method update_internals].  
         *  **Warning:** Implementing this method may degrade the [TileMapLayer]'s performance.  
         */
        /* gdvirtual */ _update_cells(coords: GArray<Vector2i>, forced_cleanup: boolean): void
        
        /** Sets the tile identifiers for the cell at coordinates [param coords]. Each tile of the [TileSet] is identified using three parts:  
         *  - The source identifier [param source_id] identifies a [TileSetSource] identifier. See [method TileSet.set_source_id],  
         *  - The atlas coordinate identifier [param atlas_coords] identifies a tile coordinates in the atlas (if the source is a [TileSetAtlasSource]). For [TileSetScenesCollectionSource] it should always be `Vector2i(0, 0)`,  
         *  - The alternative tile identifier [param alternative_tile] identifies a tile alternative in the atlas (if the source is a [TileSetAtlasSource]), and the scene for a [TileSetScenesCollectionSource].  
         *  If [param source_id] is set to `-1`, [param atlas_coords] to `Vector2i(-1, -1)`, or [param alternative_tile] to `-1`, the cell will be erased. An erased cell gets **all** its identifiers automatically set to their respective invalid values, namely `-1`, `Vector2i(-1, -1)` and `-1`.  
         */
        set_cell(coords: Vector2i, source_id?: int64 /* = -1 */, atlas_coords?: Vector2i /* = new Vector2i(-1, -1) */, alternative_tile?: int64 /* = 0 */): void
        
        /** Erases the cell at coordinates [param coords]. */
        erase_cell(coords: Vector2i): void
        
        /** Clears cells containing tiles that do not exist in the [member tile_set]. */
        fix_invalid_tiles(): void
        
        /** Clears all cells. */
        clear(): void
        
        /** Returns the tile source ID of the cell at coordinates [param coords]. Returns `-1` if the cell does not exist. */
        get_cell_source_id(coords: Vector2i): int64
        
        /** Returns the tile atlas coordinates ID of the cell at coordinates [param coords]. Returns `Vector2i(-1, -1)` if the cell does not exist. */
        get_cell_atlas_coords(coords: Vector2i): Vector2i
        
        /** Returns the tile alternative ID of the cell at coordinates [param coords]. */
        get_cell_alternative_tile(coords: Vector2i): int64
        
        /** Returns the [TileData] object associated with the given cell, or `null` if the cell does not exist or is not a [TileSetAtlasSource].  
         *    
         */
        get_cell_tile_data(coords: Vector2i): null | TileData
        
        /** Returns `true` if the cell at coordinates [param coords] is flipped horizontally. The result is valid only for atlas sources. */
        is_cell_flipped_h(coords: Vector2i): boolean
        
        /** Returns `true` if the cell at coordinates [param coords] is flipped vertically. The result is valid only for atlas sources. */
        is_cell_flipped_v(coords: Vector2i): boolean
        
        /** Returns `true` if the cell at coordinates [param coords] is transposed. The result is valid only for atlas sources. */
        is_cell_transposed(coords: Vector2i): boolean
        
        /** Returns a [Vector2i] array with the positions of all cells containing a tile. A cell is considered empty if its source identifier equals `-1`, its atlas coordinate identifier is `Vector2(-1, -1)` and its alternative identifier is `-1`. */
        get_used_cells(): GArray<Vector2i>
        
        /** Returns a [Vector2i] array with the positions of all cells containing a tile. Tiles may be filtered according to their source ([param source_id]), their atlas coordinates ([param atlas_coords]), or alternative id ([param alternative_tile]).  
         *  If a parameter has its value set to the default one, this parameter is not used to filter a cell. Thus, if all parameters have their respective default values, this method returns the same result as [method get_used_cells].  
         *  A cell is considered empty if its source identifier equals `-1`, its atlas coordinate identifier is `Vector2(-1, -1)` and its alternative identifier is `-1`.  
         */
        get_used_cells_by_id(source_id?: int64 /* = -1 */, atlas_coords?: Vector2i /* = new Vector2i(-1, -1) */, alternative_tile?: int64 /* = -1 */): GArray<Vector2i>
        
        /** Returns a rectangle enclosing the used (non-empty) tiles of the map. */
        get_used_rect(): Rect2i
        
        /** Creates and returns a new [TileMapPattern] from the given array of cells. See also [method set_pattern]. */
        get_pattern(coords_array: GArray<Vector2i>): null | TileMapPattern
        
        /** Pastes the [TileMapPattern] at the given [param position] in the tile map. See also [method get_pattern]. */
        set_pattern(position: Vector2i, pattern: TileMapPattern): void
        
        /** Update all the cells in the [param cells] coordinates array so that they use the given [param terrain] for the given [param terrain_set]. If an updated cell has the same terrain as one of its neighboring cells, this function tries to join the two. This function might update neighboring tiles if needed to create correct terrain transitions.  
         *  If [param ignore_empty_terrains] is `true`, empty terrains will be ignored when trying to find the best fitting tile for the given terrain constraints.  
         *      
         *  **Note:** To work correctly, this method requires the [TileMapLayer]'s TileSet to have terrains set up with all required terrain combinations. Otherwise, it may produce unexpected results.  
         */
        set_cells_terrain_connect(cells: GArray<Vector2i>, terrain_set: int64, terrain: int64, ignore_empty_terrains?: boolean /* = true */): void
        
        /** Update all the cells in the [param path] coordinates array so that they use the given [param terrain] for the given [param terrain_set]. The function will also connect two successive cell in the path with the same terrain. This function might update neighboring tiles if needed to create correct terrain transitions.  
         *  If [param ignore_empty_terrains] is `true`, empty terrains will be ignored when trying to find the best fitting tile for the given terrain constraints.  
         *      
         *  **Note:** To work correctly, this method requires the [TileMapLayer]'s TileSet to have terrains set up with all required terrain combinations. Otherwise, it may produce unexpected results.  
         */
        set_cells_terrain_path(path: GArray<Vector2i>, terrain_set: int64, terrain: int64, ignore_empty_terrains?: boolean /* = true */): void
        
        /** Returns whether the provided [param body] [RID] belongs to one of this [TileMapLayer]'s cells. */
        has_body_rid(body: RID): boolean
        
        /** Returns the coordinates of the physics quadrant (see [member physics_quadrant_size]) for given physics body [RID]. Such an [RID] can be retrieved from [method KinematicCollision2D.get_collider_rid], when colliding with a tile.  
         *      
         *  **Note:** Higher values of [member physics_quadrant_size] will make this function less precise. To get the exact cell coordinates, you need to set [member physics_quadrant_size] to `1`, which disables physics chunking.  
         */
        get_coords_for_body_rid(body: RID): Vector2i
        
        /** Triggers a direct update of the [TileMapLayer]. Usually, calling this function is not needed, as [TileMapLayer] node updates automatically when one of its properties or cells is modified.  
         *  However, for performance reasons, those updates are batched and delayed to the end of the frame. Calling this function will force the [TileMapLayer] to update right away instead.  
         *  **Warning:** Updating the [TileMapLayer] is computationally expensive and may impact performance. Try to limit the number of updates and how many tiles they impact.  
         */
        update_internals(): void
        
        /** Notifies the [TileMapLayer] node that calls to [method _use_tile_data_runtime_update] or [method _tile_data_runtime_update] will lead to different results. This will thus trigger a [TileMapLayer] update.  
         *  **Warning:** Updating the [TileMapLayer] is computationally expensive and may impact performance. Try to limit the number of calls to this function to avoid unnecessary update.  
         *      
         *  **Note:** This does not trigger a direct update of the [TileMapLayer], the update will be done at the end of the frame as usual (unless you call [method update_internals]).  
         */
        notify_runtime_tile_data_update(): void
        
        /** Returns for the given coordinates [param coords_in_pattern] in a [TileMapPattern] the corresponding cell coordinates if the pattern was pasted at the [param position_in_tilemap] coordinates (see [method set_pattern]). This mapping is required as in half-offset tile shapes, the mapping might not work by calculating `position_in_tile_map + coords_in_pattern`. */
        map_pattern(position_in_tilemap: Vector2i, coords_in_pattern: Vector2i, pattern: TileMapPattern): Vector2i
        
        /** Returns the list of all neighboring cells to the one at [param coords]. Any neighboring cell is one that is touching edges, so for a square cell 4 cells would be returned, for a hexagon 6 cells are returned. */
        get_surrounding_cells(coords: Vector2i): GArray<Vector2i>
        
        /** Returns the neighboring cell to the one at coordinates [param coords], identified by the [param neighbor] direction. This method takes into account the different layouts a TileMap can take. */
        get_neighbor_cell(coords: Vector2i, neighbor: TileSet.CellNeighbor): Vector2i
        
        /** Returns the centered position of a cell in the [TileMapLayer]'s local coordinate space. To convert the returned value into global coordinates, use [method Node2D.to_global]. See also [method local_to_map].  
         *      
         *  **Note:** This may not correspond to the visual position of the tile, i.e. it ignores the [member TileData.texture_origin] property of individual tiles.  
         */
        map_to_local(map_position: Vector2i): Vector2
        
        /** Returns the map coordinates of the cell containing the given [param local_position]. If [param local_position] is in global coordinates, consider using [method Node2D.to_local] before passing it to this method. See also [method map_to_local]. */
        local_to_map(local_position: Vector2): Vector2i
        
        /** Sets a custom [param map] as a [NavigationServer2D] navigation map. If not set, uses the default [World2D] navigation map instead. */
        set_navigation_map(map: RID): void
        
        /** Returns the [RID] of the [NavigationServer2D] navigation used by this [TileMapLayer].  
         *  By default this returns the default [World2D] navigation map, unless a custom map was provided using [method set_navigation_map].  
         */
        get_navigation_map(): RID
        
        /** The raw tile map data as a byte array. */
        get tile_map_data(): PackedByteArray
        set tile_map_data(value: PackedByteArray | byte[] | ArrayBuffer)
        
        /** If `false`, disables this [TileMapLayer] completely (rendering, collision, navigation, scene tiles, etc.) */
        get enabled(): boolean
        set enabled(value: boolean)
        
        /** The [TileSet] used by this layer. The textures, collisions, and additional behavior of all available tiles are stored here. */
        get tile_set(): null | TileSet
        set tile_set(value: null | TileSet)
        
        /** Enable or disable light occlusion. */
        get occlusion_enabled(): boolean
        set occlusion_enabled(value: boolean)
        
        /** This Y-sort origin value is added to each tile's Y-sort origin value. This allows, for example, to fake a different height level. This can be useful for top-down view games. */
        get y_sort_origin(): int64
        set y_sort_origin(value: int64)
        
        /** If [member CanvasItem.y_sort_enabled] is enabled, setting this to `true` will reverse the order the tiles are drawn on the X-axis. */
        get x_draw_order_reversed(): boolean
        set x_draw_order_reversed(value: boolean)
        
        /** The [TileMapLayer]'s rendering quadrant size. A quadrant is a group of tiles to be drawn together on a single canvas item, for optimization purposes. [member rendering_quadrant_size] defines the length of a square's side, in the map's coordinate system, that forms the quadrant. Thus, the default quadrant size groups together `16 * 16 = 256` tiles.  
         *  The quadrant size does not apply on a Y-sorted [TileMapLayer], as tiles are grouped by Y position instead in that case.  
         *      
         *  **Note:** As quadrants are created according to the map's coordinate system, the quadrant's "square shape" might not look like square in the [TileMapLayer]'s local coordinate system.  
         */
        get rendering_quadrant_size(): int64
        set rendering_quadrant_size(value: int64)
        
        /** Enable or disable collisions. */
        get collision_enabled(): boolean
        set collision_enabled(value: boolean)
        
        /** If `true`, this [TileMapLayer] collision shapes will be instantiated as kinematic bodies. This can be needed for moving [TileMapLayer] nodes (i.e. moving platforms). */
        get use_kinematic_bodies(): boolean
        set use_kinematic_bodies(value: boolean)
        
        /** Show or hide the [TileMapLayer]'s collision shapes. If set to [constant DEBUG_VISIBILITY_MODE_DEFAULT], this depends on the show collision debug settings. */
        get collision_visibility_mode(): int64
        set collision_visibility_mode(value: int64)
        
        /** The [TileMapLayer]'s physics quadrant size. Within a physics quadrant, cells with similar physics properties are grouped together and their collision shapes get merged. [member physics_quadrant_size] defines the length of a square's side, in the map's coordinate system, that forms the quadrant. Thus, the default quadrant size groups together `16 * 16 = 256` tiles.  
         *      
         *  **Note:** As quadrants are created according to the map's coordinate system, the quadrant's "square shape" might not look like square in the [TileMapLayer]'s local coordinate system.  
         *      
         *  **Note:** This impacts the value returned by [method get_coords_for_body_rid]. Higher values will make that function less precise. To get the exact cell coordinates, you need to set [member physics_quadrant_size] to `1`, which disables physics chunking.  
         */
        get physics_quadrant_size(): int64
        set physics_quadrant_size(value: int64)
        
        /** If `true`, navigation regions are enabled. */
        get navigation_enabled(): boolean
        set navigation_enabled(value: boolean)
        
        /** Show or hide the [TileMapLayer]'s navigation meshes. If set to [constant DEBUG_VISIBILITY_MODE_DEFAULT], this depends on the show navigation debug settings. */
        get navigation_visibility_mode(): int64
        set navigation_visibility_mode(value: int64)
        
        /** Emitted when this [TileMapLayer]'s properties changes. This includes modified cells, properties, or changes made to its assigned [TileSet].  
         *      
         *  **Note:** This signal may be emitted very often when batch-modifying a [TileMapLayer]. Avoid executing complex processing in a connected function, and consider delaying it to the end of the frame instead (i.e. calling [method Object.call_deferred]).  
         */
        readonly changed: Signal<() => void>
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTileMapLayer;
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTileMapPattern extends __NameMapResource {
    }
    /** Holds a pattern to be copied from or pasted into [TileMap]s.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tilemappattern.html  
     */
    class TileMapPattern extends Resource {
        constructor(identifier?: any)
        /** Sets the tile identifiers for the cell at coordinates [param coords]. See [method TileMap.set_cell]. */
        set_cell(coords: Vector2i, source_id?: int64 /* = -1 */, atlas_coords?: Vector2i /* = new Vector2i(-1, -1) */, alternative_tile?: int64 /* = -1 */): void
        
        /** Returns whether the pattern has a tile at the given coordinates. */
        has_cell(coords: Vector2i): boolean
        
        /** Remove the cell at the given coordinates. */
        remove_cell(coords: Vector2i, update_size: boolean): void
        
        /** Returns the tile source ID of the cell at [param coords]. */
        get_cell_source_id(coords: Vector2i): int64
        
        /** Returns the tile atlas coordinates ID of the cell at [param coords]. */
        get_cell_atlas_coords(coords: Vector2i): Vector2i
        
        /** Returns the tile alternative ID of the cell at [param coords]. */
        get_cell_alternative_tile(coords: Vector2i): int64
        
        /** Returns the list of used cell coordinates in the pattern. */
        get_used_cells(): GArray<Vector2i>
        
        /** Returns the size, in cells, of the pattern. */
        get_size(): Vector2i
        
        /** Sets the size of the pattern. */
        set_size(size: Vector2i): void
        
        /** Returns whether the pattern is empty or not. */
        is_empty(): boolean
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTileMapPattern;
    }
    namespace TileSet {
        enum TileShape {
            /** Rectangular tile shape. */
            TILE_SHAPE_SQUARE = 0,
            
            /** Diamond tile shape (for isometric look).  
             *      
             *  **Note:** Isometric [TileSet] works best if all sibling [TileMapLayer]s and their parent inheriting from [Node2D] have Y-sort enabled.  
             */
            TILE_SHAPE_ISOMETRIC = 1,
            
            /** Rectangular tile shape with one row/column out of two offset by half a tile. */
            TILE_SHAPE_HALF_OFFSET_SQUARE = 2,
            
            /** Hexagonal tile shape. */
            TILE_SHAPE_HEXAGON = 3,
        }
        enum TileLayout {
            /** Tile coordinates layout where both axis stay consistent with their respective local horizontal and vertical axis. */
            TILE_LAYOUT_STACKED = 0,
            
            /** Same as [constant TILE_LAYOUT_STACKED], but the first half-offset is negative instead of positive. */
            TILE_LAYOUT_STACKED_OFFSET = 1,
            
            /** Tile coordinates layout where the horizontal axis stay horizontal, and the vertical one goes down-right. */
            TILE_LAYOUT_STAIRS_RIGHT = 2,
            
            /** Tile coordinates layout where the vertical axis stay vertical, and the horizontal one goes down-right. */
            TILE_LAYOUT_STAIRS_DOWN = 3,
            
            /** Tile coordinates layout where the horizontal axis goes up-right, and the vertical one goes down-right. */
            TILE_LAYOUT_DIAMOND_RIGHT = 4,
            
            /** Tile coordinates layout where the horizontal axis goes down-right, and the vertical one goes down-left. */
            TILE_LAYOUT_DIAMOND_DOWN = 5,
        }
        enum TileOffsetAxis {
            /** Horizontal half-offset. */
            TILE_OFFSET_AXIS_HORIZONTAL = 0,
            
            /** Vertical half-offset. */
            TILE_OFFSET_AXIS_VERTICAL = 1,
        }
        enum CellNeighbor {
            /** Neighbor on the right side. */
            CELL_NEIGHBOR_RIGHT_SIDE = 0,
            
            /** Neighbor in the right corner. */
            CELL_NEIGHBOR_RIGHT_CORNER = 1,
            
            /** Neighbor on the bottom right side. */
            CELL_NEIGHBOR_BOTTOM_RIGHT_SIDE = 2,
            
            /** Neighbor in the bottom right corner. */
            CELL_NEIGHBOR_BOTTOM_RIGHT_CORNER = 3,
            
            /** Neighbor on the bottom side. */
            CELL_NEIGHBOR_BOTTOM_SIDE = 4,
            
            /** Neighbor in the bottom corner. */
            CELL_NEIGHBOR_BOTTOM_CORNER = 5,
            
            /** Neighbor on the bottom left side. */
            CELL_NEIGHBOR_BOTTOM_LEFT_SIDE = 6,
            
            /** Neighbor in the bottom left corner. */
            CELL_NEIGHBOR_BOTTOM_LEFT_CORNER = 7,
            
            /** Neighbor on the left side. */
            CELL_NEIGHBOR_LEFT_SIDE = 8,
            
            /** Neighbor in the left corner. */
            CELL_NEIGHBOR_LEFT_CORNER = 9,
            
            /** Neighbor on the top left side. */
            CELL_NEIGHBOR_TOP_LEFT_SIDE = 10,
            
            /** Neighbor in the top left corner. */
            CELL_NEIGHBOR_TOP_LEFT_CORNER = 11,
            
            /** Neighbor on the top side. */
            CELL_NEIGHBOR_TOP_SIDE = 12,
            
            /** Neighbor in the top corner. */
            CELL_NEIGHBOR_TOP_CORNER = 13,
            
            /** Neighbor on the top right side. */
            CELL_NEIGHBOR_TOP_RIGHT_SIDE = 14,
            
            /** Neighbor in the top right corner. */
            CELL_NEIGHBOR_TOP_RIGHT_CORNER = 15,
        }
        enum TerrainMode {
            /** Requires both corners and side to match with neighboring tiles' terrains. */
            TERRAIN_MODE_MATCH_CORNERS_AND_SIDES = 0,
            
            /** Requires corners to match with neighboring tiles' terrains. */
            TERRAIN_MODE_MATCH_CORNERS = 1,
            
            /** Requires sides to match with neighboring tiles' terrains. */
            TERRAIN_MODE_MATCH_SIDES = 2,
        }
    }
    /** @deprecated Internal use. Does not exist at runtime. */
    interface __NameMapTileSet extends __NameMapResource {
    }
    /** Tile library for tilemaps.  
     *  	  
     *  @link https://docs.godotengine.org/en/4.6/classes/class_tileset.html  
     */
    class TileSet extends Resource {
        constructor(identifier?: any)
        /** Returns a new unused source ID. This generated ID is the same that a call to [method add_source] would return. */
        get_next_source_id(): int64
        
        /** Adds a [TileSetSource] to the TileSet. If [param atlas_source_id_override] is not -1, also set its source ID. Otherwise, a unique identifier is automatically generated.  
         *  The function returns the added source ID or -1 if the source could not be added.  
         *  **Warning:** A source cannot belong to two TileSets at the same time. If the added source was attached to another [TileSet], it will be removed from that one.  
         */
        add_source(source: TileSetSource, atlas_source_id_override?: int64 /* = -1 */): int64
        
        /** Removes the source with the given source ID. */
        remove_source(source_id: int64): void
        
        /** Changes a source's ID. */
        set_source_id(source_id: int64, new_source_id: int64): void
        
        /** Returns the number of [TileSetSource] in this TileSet. */
        get_source_count(): int64
        
        /** Returns the source ID for source with index [param index]. */
        get_source_id(index: int64): int64
        
        /** Returns if this TileSet has a source for the given source ID. */
        has_source(source_id: int64): boolean
        
        /** Returns the [TileSetSource] with ID [param source_id]. */
        get_source(source_id: int64): null | TileSetSource
        
        /** Returns the occlusion layers count. */
        get_occlusion_layers_count(): int64
        
        /** Adds an occlusion layer to the TileSet at the given position [param to_position] in the array. If [param to_position] is -1, adds it at the end of the array.  
         *  Occlusion layers allow assigning occlusion polygons to atlas tiles.  
         */
        add_occlusion_layer(to_position?: int64 /* = -1 */): void
        
        /** Moves the occlusion layer at index [param layer_index] to the given position [param to_position] in the array. Also updates the atlas tiles accordingly. */
        move_occlusion_layer(layer_index: int64, to_position: int64): void
        
        /** Removes the occlusion layer at index [param layer_index]. Also updates the atlas tiles accordingly. */
        remove_occlusion_layer(layer_index: int64): void
        
        /** Sets the occlusion layer (as in the rendering server) for occluders in the given TileSet occlusion layer. */
        set_occlusion_layer_light_mask(layer_index: int64, light_mask: int64): void
        
        /** Returns the light mask of the occlusion layer. */
        get_occlusion_layer_light_mask(layer_index: int64): int64
        
        /** Enables or disables SDF collision for occluders in the given TileSet occlusion layer. */
        set_occlusion_layer_sdf_collision(layer_index: int64, sdf_collision: boolean): void
        
        /** Returns if the occluders from this layer use `sdf_collision`. */
        get_occlusion_layer_sdf_collision(layer_index: int64): boolean
        
        /** Returns the physics layers count. */
        get_physics_layers_count(): int64
        
        /** Adds a physics layer to the TileSet at the given position [param to_position] in the array. If [param to_position] is -1, adds it at the end of the array.  
         *  Physics layers allow assigning collision polygons to atlas tiles.  
         */
        add_physics_layer(to_position?: int64 /* = -1 */): void
        
        /** Moves the physics layer at index [param layer_index] to the given position [param to_position] in the array. Also updates the atlas tiles accordingly. */
        move_physics_layer(layer_index: int64, to_position: int64): void
        
        /** Removes the physics layer at index [param layer_index]. Also updates the atlas tiles accordingly. */
        remove_physics_layer(layer_index: int64): void
        
        /** Sets the collision layer (as in the physics server) for bodies in the given TileSet physics layer. */
        set_physics_layer_collision_layer(layer_index: int64, layer: int64): void
        
        /** Returns the collision layer (as in the physics server) bodies on the given TileSet's physics layer are in. */
        get_physics_layer_collision_layer(layer_index: int64): int64
        
        /** Sets the collision mask for bodies in the given TileSet physics layer. */
        set_physics_layer_collision_mask(layer_index: int64, mask: int64): void
        
        /** Returns the collision mask of bodies on the given TileSet's physics layer. */
        get_physics_layer_collision_mask(layer_index: int64): int64
        
        /** Sets the collision priority for bodies in the given TileSet physics layer. */
        set_physics_layer_collision_priority(layer_index: int64, priority: float64): void
        
        /** Returns the collision priority of bodies on the given TileSet's physics layer. */
        get_physics_layer_collision_priority(layer_index: int64): float64
        
        /** Sets the physics material for bodies in the given TileSet physics layer. */
        set_physics_layer_physics_material(layer_index: int64, physics_material: PhysicsMaterial): void
        
        /** Returns the physics material of bodies on the given TileSet's physics layer. */
        get_physics_layer_physics_material(layer_index: int64): null | PhysicsMaterial
        
        /** Returns the terrain sets count. */
        get_terrain_sets_count(): int64
        
        /** Adds a new terrain set at the given position [param to_position] in the array. If [param to_position] is -1, adds it at the end of the array. */
        add_terrain_set(to_position?: int64 /* = -1 */): void
        
        /** Moves the terrain set at index [param terrain_set] to the given position [param to_position] in the array. Also updates the atlas tiles accordingly. */
        move_terrain_set(terrain_set: int64, to_position: int64): void
        
        /** Removes the terrain set at index [param terrain_set]. Also updates the atlas tiles accordingly. */
        remove_terrain_set(terrain_set: int64): void
        
        /** Sets a terrain mode. Each mode determines which bits of a tile shape is used to match the neighboring tiles' terrains. */
        set_terrain_set_mode(terrain_set: int64, mode: TileSet.TerrainMode): void
        
        /** Returns a terrain set mode. */
        get_terrain_set_mode(terrain_set: int64): TileSet.TerrainMode
        
        /** Returns the number of terrains in the given terrain set. */
        get_terrains_count(terrain_set: int64): int64
        
        /** Adds a new terrain to the given terrain set [param terrain_set] at the given position [param to_position] in the array. If [param to_position] is -1, adds it at the end of the array. */
        add_terrain(terrain_set: int64, to_position?: int64 /* = -1 */): void
        
        /** Moves the terrain at index [param terrain_index] for terrain set [param terrain_set] to the given position [param to_position] in the array. Also updates the atlas tiles accordingly. */
        move_terrain(terrain_set: int64, terrain_index: int64, to_position: int64): void
        
        /** Removes the terrain at index [param terrain_index] in the given terrain set [param terrain_set]. Also updates the atlas tiles accordingly. */
        remove_terrain(terrain_set: int64, terrain_index: int64): void
        
        /** Sets a terrain's name. */
        set_terrain_name(terrain_set: int64, terrain_index: int64, name: string): void
        
        /** Returns a terrain's name. */
        get_terrain_name(terrain_set: int64, terrain_index: int64): string
        
        /** Sets a terrain's color. This color is used for identifying the different terrains in the TileSet editor. */
        set_terrain_color(terrain_set: int64, terrain_index: int64, color: Color): void
        
        /** Returns a terrain's color. */
        get_terrain_color(terrain_set: int64, terrain_index: int64): Color
        
        /** Returns the navigation layers count. */
        get_navigation_layers_count(): int64
        
        /** Adds a navigation layer to the TileSet at the given position [param to_position] in the array. If [param to_position] is -1, adds it at the end of the array.  
         *  Navigation layers allow assigning a navigable area to atlas tiles.  
         */
        add_navigation_layer(to_position?: int64 /* = -1 */): void
        
        /** Moves the navigation layer at index [param layer_index] to the given position [param to_position] in the array. Also updates the atlas tiles accordingly. */
        move_navigation_layer(layer_index: int64, to_position: int64): void
        
        /** Removes the navigation layer at index [param layer_index]. Also updates the atlas tiles accordingly. */
        remove_navigation_layer(layer_index: int64): void
        
        /** Sets the navigation layers (as in the navigation server) for navigation regions in the given TileSet navigation layer. */
        set_navigation_layer_layers(layer_index: int64, layers: int64): void
        
        /** Returns the navigation layers (as in the Navigation server) of the given TileSet navigation layer. */
        get_navigation_layer_layers(layer_index: int64): int64
        
        /** Based on [param value], enables or disables the specified navigation layer of the TileSet navigation data layer identified by the given [param layer_index], given a navigation_layers [param layer_number] between 1 and 32. */
        set_navigation_layer_layer_value(layer_index: int64, layer_number: int64, value: boolean): void
        
        /** Returns whether or not the specified navigation layer of the TileSet navigation data layer identified by the given [param layer_index] is enabled, given a navigation_layers [param layer_number] between 1 and 32. */
        get_navigation_layer_layer_value(layer_index: int64, layer_number: int64): boolean
        
        /** Returns the custom data layers count. */
        get_custom_data_layers_count(): int64
        
        /** Adds a custom data layer to the TileSet at the given position [param to_position] in the array. If [param to_position] is -1, adds it at the end of the array.  
         *  Custom data layers allow assigning custom properties to atlas tiles.  
         */
        add_custom_data_layer(to_position?: int64 /* = -1 */): void
        
        /** Moves the custom data layer at index [param layer_index] to the given position [param to_position] in the array. Also updates the atlas tiles accordingly. */
        move_custom_data_layer(layer_index: int64, to_position: int64): void
        
        /** Removes the custom data layer at index [param layer_index]. Also updates the atlas tiles accordingly. */
        remove_custom_data_layer(layer_index: int64): void
        
        /** Returns the index of the custom data layer identified by the given name. */
        get_custom_data_layer_by_name(layer_name: string): int64
        
        /** Sets the name of the custom data layer identified by the given index. Names are identifiers of the layer therefore if the name is already taken it will fail and raise an error. */
        set_custom_data_layer_name(layer_index: int64, layer_name: string): void
        
        /** Returns if there is a custom data layer named [param layer_name]. */
        has_custom_data_layer_by_name(layer_name: string): boolean
        
        /** Returns the name of the custom data layer identified by the given index. */
        get_custom_data_layer_name(layer_index: int64): string
        
        /** Sets the type of the custom data layer identified by the given index. */
        set_custom_data_layer_type(layer_index: int64, layer_type: Variant.Type): void
        
        /** Returns the type of the custom data layer identified by the given index. */
        get_custom_data_layer_type(layer_index: int64): Variant.Type
        
        /** Creates a source-level proxy for the given source ID. A proxy will map set of tile identifiers to another set of identifiers. Both the atlas coordinates ID and the alternative tile ID are kept the same when using source-level proxies.  
         *  Proxied tiles can be automatically replaced in TileMapLayer nodes using the editor.  
         */
        set_source_level_tile_proxy(source_from: int64, source_to: int64): void
        
        /** Returns the source-level proxy for the given source identifier.  
         *  If the TileSet has no proxy for the given identifier, returns -1.  
         */
        get_source_level_tile_proxy(source_from: int64): int64
        
        /** Returns if there is a source-level proxy for the given source ID. */
        has_source_level_tile_proxy(source_from: int64): boolean
        
        /** Removes a source-level tile proxy. */
        remove_source_level_tile_proxy(source_from: int64): void
        
        /** Creates a coordinates-level proxy for the given identifiers. A proxy will map set of tile identifiers to another set of identifiers. The alternative tile ID is kept the same when using coordinates-level proxies.  
         *  Proxied tiles can be automatically replaced in TileMapLayer nodes using the editor.  
         */
        set_coords_level_tile_proxy(p_source_from: int64, coords_from: Vector2i, source_to: int64, coords_to: Vector2i): void
        
        /** Returns the coordinate-level proxy for the given identifiers. The returned array contains the two target identifiers of the proxy (source ID and atlas coordinates ID).  
         *  If the TileSet has no proxy for the given identifiers, returns an empty Array.  
         */
        get_coords_level_tile_proxy(source_from: int64, coords_from: Vector2i): GArray
        
        /** Returns if there is a coodinates-level proxy for the given identifiers. */
        has_coords_level_tile_proxy(source_from: int64, coords_from: Vector2i): boolean
        
        /** Removes a coordinates-level proxy for the given identifiers. */
        remove_coords_level_tile_proxy(source_from: int64, coords_from: Vector2i): void
        
        /** Create an alternative-level proxy for the given identifiers. A proxy will map set of tile identifiers to another set of identifiers.  
         *  Proxied tiles can be automatically replaced in TileMapLayer nodes using the editor.  
         */
        set_alternative_level_tile_proxy(source_from: int64, coords_from: Vector2i, alternative_from: int64, source_to: int64, coords_to: Vector2i, alternative_to: int64): void
        
        /** Returns the alternative-level proxy for the given identifiers. The returned array contains the three proxie's target identifiers (source ID, atlas coords ID and alternative tile ID).  
         *  If the TileSet has no proxy for the given identifiers, returns an empty Array.  
         */
        get_alternative_level_tile_proxy(source_from: int64, coords_from: Vector2i, alternative_from: int64): GArray
        
        /** Returns if there is an alternative-level proxy for the given identifiers. */
        has_alternative_level_tile_proxy(source_from: int64, coords_from: Vector2i, alternative_from: int64): boolean
        
        /** Removes an alternative-level proxy for the given identifiers. */
        remove_alternative_level_tile_proxy(source_from: int64, coords_from: Vector2i, alternative_from: int64): void
        
        /** According to the configured proxies, maps the provided identifiers to a new set of identifiers. The source ID, atlas coordinates ID and alternative tile ID are returned as a 3 elements Array.  
         *  This function first look for matching alternative-level proxies, then coordinates-level proxies, then source-level proxies.  
         *  If no proxy corresponding to provided identifiers are found, returns the same values the ones used as arguments.  
         */
        map_tile_proxy(source_from: int64, coords_from: Vector2i, alternative_from: int64): GArray
        
        /** Clears tile proxies pointing to invalid tiles. */
        cleanup_invalid_tile_proxies(): void
        
        /** Clears all tile proxies. */
        clear_tile_proxies(): void
        
        /** Adds a [TileMapPattern] to be stored in the TileSet resource. If provided, insert it at the given [param index]. */
        add_pattern(pattern: TileMapPattern, index?: int64 /* = -1 */): int64
        
        /** Returns the [TileMapPattern] at the given [param index]. */
        get_pattern(index?: int64 /* = -1 */): null | TileMapPattern
        
        /** Remove the [TileMapPattern] at the given index. */
        remove_pattern(index: int64): void
        
        /** Returns the number of [TileMapPattern] this tile set handles. */
        get_patterns_count(): int64
        
        /** The tile shape. */
        get tile_shape(): int64
        set tile_shape(value: int64)
        
        /** For all half-offset shapes (Isometric, Hexagonal and Half-Offset square), changes the way tiles are indexed in the [TileMapLayer] grid. */
        get tile_layout(): int64
        set tile_layout(value: int64)
        
        /** For all half-offset shapes (Isometric, Hexagonal and Half-Offset square), determines the offset axis. */
        get tile_offset_axis(): int64
        set tile_offset_axis(value: int64)
        
        /** The tile size, in pixels. For all tile shapes, this size corresponds to the encompassing rectangle of the tile shape. This is thus the minimal cell size required in an atlas. */
        get tile_size(): Vector2i
        set tile_size(value: Vector2i)
        
        /** Enables/Disable uv clipping when rendering the tiles. */
        get uv_clipping(): boolean
        set uv_clipping(value: boolean)
        /** @deprecated Internal use. Does not exist at runtime. */
        __godotNameMap: __NameMapTileSet;
    }
}
