param(
    [Parameter(Mandatory=$true)][string]$InputDirectory,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [switch]$VerifyEditability
)
# Экспортирует уже собранные PPTX. Не перезаписывает презентации или чужие PDF.
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$inputPath = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $InputDirectory))
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $OutputDirectory))
if (!$inputPath.StartsWith($taskRoot + '\') -or !$outputPath.StartsWith($taskRoot + '\.review\')) {
    throw 'Экспорт выполняется из репозитория в новый локальный каталог .review'
}
$names = @('cultural-plan', 'cultural-plan-submission-preview')
foreach ($name in $names) {
    if (!(Test-Path -LiteralPath (Join-Path $inputPath ($name + '.pptx')))) { throw 'Нет входного PPTX' }
    if (Test-Path -LiteralPath (Join-Path $outputPath ($name + '.pdf'))) { throw 'Выход уже существует' }
}
[void][System.IO.Directory]::CreateDirectory($outputPath)
$app = $null
$deck = $null
$initialCount = -1
$results = @()
try {
    $app = New-Object -ComObject PowerPoint.Application
    $initialCount = $app.Presentations.Count
    foreach ($name in $names) {
        $path = Join-Path $inputPath ($name + '.pptx')
        $deck = $app.Presentations.Open($path, -1, 0, 0)
        $count = $deck.Slides.Count
        $deck.SaveAs((Join-Path $outputPath ($name + '.pdf')), 32)
        $deck.Close()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($deck)
        $deck = $null
        $edited = $false
        if ($VerifyEditability) {
            $copy = Join-Path $outputPath ($name + '-edit-test.pptx')
            if (Test-Path -LiteralPath $copy) { throw 'Копия проверки уже существует' }
            Copy-Item -LiteralPath $path -Destination $copy
            $deck = $app.Presentations.Open($copy, 0, 0, 0)
            $offset = $count - 13
            $title = $deck.Slides.Item(2 + $offset).Shapes.Item(1)
            if ($title.HasTextFrame -ne -1) { throw 'Нет редактируемого текста' }
            $title.TextFrame.TextRange.Text = 'Проверка редактирования — ₽'
            $group = $null
            foreach ($shape in $deck.Slides.Item(7 + $offset).Shapes) {
                if ($shape.Type -eq 6) {
                    foreach ($child in $shape.GroupItems) {
                        if ($child.HasTextFrame -eq -1 -and $child.TextFrame.TextRange.Text -eq 'Сервер приложения') { $group = $shape }
                    }
                }
            }
            if ($null -eq $group) { throw 'Нет группы архитектуры' }
            $groupId = $group.Id
            $oldX = $group.Left
            $group.Left = $oldX + 12
            $deck.Save()
            $deck.Close()
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($deck)
            $deck = $app.Presentations.Open($copy, -1, 0, 0)
            if ($deck.Slides.Item(2 + $offset).Shapes.Item(1).TextFrame.TextRange.Text -ne 'Проверка редактирования — ₽') { throw 'Текст не сохранился' }
            $moved = $null
            foreach ($shape in $deck.Slides.Item(7 + $offset).Shapes) { if ($shape.Id -eq $groupId) { $moved = $shape } }
            if ($null -eq $moved -or [Math]::Abs($moved.Left - ($oldX + 12)) -gt 0.01) { throw 'Группа не сохранилась' }
            $deck.Close()
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($deck)
            $deck = $null
            $edited = $true
        }
        $results += @{ file = ($name + '.pptx'); slides = $count; textAndGroupSavedReopened = $edited }
    }
    $report = @{ renderer = ('Microsoft PowerPoint ' + $app.Version); decks = $results }
    $json = $report | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText((Join-Path $outputPath 'office.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output $json
} finally {
    if ($null -ne $deck) { $deck.Close(); [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($deck) }
    if ($null -ne $app) {
        if ($initialCount -eq 0 -and $app.Presentations.Count -eq 0) { $app.Quit() }
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
    }
}
