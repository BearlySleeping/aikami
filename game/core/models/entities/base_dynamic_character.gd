class_name BaseDynamicCharacter
extends BaseModel

# Dynamic properties
var level := 1
var attack := 5
var defense := 5
var health := 100
var mana := 100
var experience := 0
var inventory: Array = []
var equipment: Array = []


# Function to update health
func update_health(amount: int) -> void:
	health += amount
	# Ensure health does not drop below 0 or exceed max health
	health = max(health, 0)
	health = min(health, calculate_max_health())


# Function to calculate max health, which might depend on level, class, etc.
func calculate_max_health() -> int:
	return 100  # Placeholder, implement based on your game's rules


# Function to add experience and handle leveling up
func add_experience(p_experience: int) -> void:
	experience += p_experience
	# Placeholder leveling logic, implement based on your game's rules
	if experience >= 1000:  # Example threshold
		level += 1
		experience = 0  # Reset experience or carry over, based on your game's design


func _init(data: Dictionary) -> void:
	level = data.get("level", 1)
	attack = data.get("attack", 5)
	defense = data.get("defense", 5)
	health = data.get("health", 100)
	mana = data.get("mana", 100)
	experience = data.get("experience", 0)
	inventory = data.get("inventory", [])
	equipment = data.get("equipment", [])


func to_dict() -> Dictionary:
	var dict := {"level": level, "health": health, "experience": experience, "attack": attack}
	if inventory and not inventory.is_empty():
		dict.inventory = inventory
	if equipment and not equipment.is_empty():
		dict.equipment = equipment
	return dict
