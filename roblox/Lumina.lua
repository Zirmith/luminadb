local Lumina = {}

function Lumina:GetPlayer(userId)
    local player = {
        UserId = userId,
        Coins = 0,
        Save = function(self)
            return true
        end
    }
    return player
end

return Lumina
