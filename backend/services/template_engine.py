import re
from datetime import datetime
import json


def render_template(content: str, variable_data: dict) -> str:
    """
    Render template dengan substitusi variabel.
    Variabel format: {variable_name}
    Built-in: {date}, {time}, {datetime}
    """
    # Isi built-in variables
    now = datetime.now()
    built_in = {
        "date": now.strftime("%d/%m/%Y"),
        "time": now.strftime("%H:%M"),
        "datetime": now.strftime("%d/%m/%Y %H:%M"),
    }

    # Merge built-in dengan user-defined (user bisa override)
    variables = {**built_in, **variable_data}

    # Substitusi variabel
    def replace_var(match):
        key = match.group(1).strip()
        return str(variables.get(key, match.group(0)))  # Kalau tidak ada, biarkan {var}

    result = re.sub(r"\{(\w+)\}", replace_var, content)
    return result


def extract_variables(content: str) -> list:
    """Ekstrak semua nama variabel dari template content."""
    built_in = {"date", "time", "datetime"}
    found = re.findall(r"\{(\w+)\}", content)
    return [v for v in set(found) if v not in built_in]
