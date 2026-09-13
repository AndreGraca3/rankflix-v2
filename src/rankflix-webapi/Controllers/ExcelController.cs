using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Rankflix.Services;
using System.Security.Claims;

namespace Rankflix.Controllers;

[ApiController]
[Route("api/groups/{groupId:int}/excel")]
[Authorize]
public class ExcelController(IExcelService excelService, IGroupService groupService) : ControllerBase
{
    [HttpGet("export")]
    public async Task<IActionResult> Export(int groupId)
    {
        try
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            await groupService.EnsureMemberAsync(groupId, userId);
            var bytes = await excelService.ExportGroupAsync(groupId);
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"rankflix-group-{groupId}.xlsx");
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }

    [HttpPost("import")]
    public async Task<IActionResult> Import(int groupId, IFormFile file)
    {
        if (file.Length == 0) return BadRequest("No file uploaded");

        try
        {
            var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            await groupService.EnsureManagerAsync(groupId, userId, User.IsInRole("admin"));
            await using var stream = file.OpenReadStream();
            var result = await excelService.ImportGroupAsync(groupId, stream, userId);
            return Ok(result);
        }
        catch (AppException ex)
        {
            return Problem(ex.Message, statusCode: ex.StatusCode);
        }
    }
}
