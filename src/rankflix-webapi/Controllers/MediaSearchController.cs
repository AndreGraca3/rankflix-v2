using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Services;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/media/search")]
[Authorize]
public class MediaSearchController(IMediaSearchService searchService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<MediaSearchResult>>> Search([FromQuery] string query)
    {
        return await searchService.SearchAsync(query);
    }
}
