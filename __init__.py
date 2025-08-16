from aiohttp import web
from server import PromptServer
from . import utils


NODE_CLASS_MAPPINGS = {}
WEB_DIRECTORY = "./web"

routes = PromptServer.instance.routes

# ===============================================
# APIエンドポイント
# ===============================================

# debug print
@routes.post(utils._endpoint("debug"))
async def debug(request: web.Request):
    data = await request.json()
    utils.log(data)
    return web.Response()
