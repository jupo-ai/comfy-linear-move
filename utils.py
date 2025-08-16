author = "jupo"
packageName = "LinearMove"

def log(message: str):
    print(f"[{packageName}] {message}")

def _name(name):
    return f"{author}.{packageName}.{name}"


def _endpoint(part):
    return f"/{author}/{packageName}/{part}"
