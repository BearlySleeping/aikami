-   If gdlint/gdformat crashes

`AttributeError: 'PatternStr' object has no attribute 'raw'`

`lark.exceptions.UnexpectedCharacters:`

It might be because you are using lambda function directly like this:

```python

test.connect(func()->void:
    if statment:
        return x
)

```

to fix it, move the content into another function.

```python
test.connect(_on_test_connect)

func _on_test_connect....

```
