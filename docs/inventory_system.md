# Inventory System

Current inventory system is a fork of

<https://github.com/peter-kish/gloot/blob/master/docs/docs.md>

See the implementation here: `game/core/items`

## Overview
This inventory system is designed for managing items in a grid format with stacking capabilities and weight constraints. It is ideal for games where inventory management includes spatial organization and weight limitations.

## Features
- **Grid-Based Layout**: Items are organized in a grid, where each item occupies a set number of grid cells.
- **Stacking**: Items of the same type can stack within a single grid cell up to a predefined limit.
- **Weight Constraints**: Each item has a weight, and the total weight of the items can affect gameplay, such as movement speed or stamina.
- **Dynamic Interaction**: Items can be added, removed, or moved within the grid through user interaction or script commands.

## Inventory Types
- **InventoryGridStacked**: Supports grid-based organization with stacking capabilities. Each slot in the grid can hold a stack of similar items, and the total weight is calculated based on the stack size and individual item weight.

## Item Properties
- **ID**: Unique identifier for the item.
- **Name**: Display name of the item.
- **Weight**: Weight of a single item.
- **StackSize**: Current number of items in the stack.
- **MaxStackSize**: Maximum number of items that can stack in one grid slot.

## Usage
### Adding Items with GDScript
To add items to the inventory, you can use the `create_and_add_item()` method provided by the inventory system. Here's an example of how to add an item to the inventory:
